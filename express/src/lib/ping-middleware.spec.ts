import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import { createClient } from './create-client';
import { pingMiddleware, type PingMiddlewareOptions } from './ping-middleware';
import { startTestServer, waitFor, type TestServer } from './__testutils__/http-server';

/** Minimal EventEmitter-based response with a settable status code. */
class FakeResponse extends EventEmitter {
  statusCode = 200;
  finish(status: number): void {
    this.statusCode = status;
    this.emit('finish');
  }
}

describe('pingMiddleware', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  function invoke(status: number, options?: PingMiddlewareOptions, req: Partial<Request> = {}) {
    const job = createClient({ baseUrl: server.baseUrl }).registerJob('tok');
    const res = new FakeResponse();
    const next: NextFunction = jest.fn();

    pingMiddleware(job, options)(req as Request, res as unknown as Response, next);
    res.finish(status);
    return { next };
  }

  it('calls next() exactly once and does not throw', async () => {
    const { next } = invoke(200);
    expect(next).toHaveBeenCalledTimes(1);
    // Let the fire-and-forget ping settle before teardown closes the server.
    await waitFor(() => server.requests.length === 1);
  });

  it('sends a success ping with duration when status is below the threshold', async () => {
    invoke(204);
    await waitFor(() => server.requests.length === 1);

    expect(server.requests[0].path).toBe('/api/signals/ping/tok');
    expect(server.requests[0].query.get('duration')).not.toBeNull();
  });

  it('never sends an Authorization header on the ping', async () => {
    invoke(200);
    await waitFor(() => server.requests.length === 1);
    expect(server.requests[0].headers['authorization']).toBeUndefined();
  });

  it('never sends an Authorization header on the fail ping (500)', async () => {
    invoke(500);
    await waitFor(() => server.requests.length === 1);
    expect(server.requests[0].path).toBe('/api/signals/ping/tok/fail');
    expect(server.requests[0].headers['authorization']).toBeUndefined();
  });

  it('sends a fail ping when status is at or above the threshold', async () => {
    invoke(500);
    await waitFor(() => server.requests.length === 1);
    expect(server.requests[0].path).toBe('/api/signals/ping/tok/fail');
  });

  it('honours a custom failStatusThreshold', async () => {
    invoke(404, { failStatusThreshold: 400 });
    await waitFor(() => server.requests.length === 1);
    expect(server.requests[0].path).toBe('/api/signals/ping/tok/fail');
  });

  it('omits the duration param when includeDuration is false', async () => {
    invoke(200, { includeDuration: false });
    await waitFor(() => server.requests.length === 1);
    expect(server.requests[0].query.get('duration')).toBeNull();
  });

  it('adds the rid query param from the rid callback', async () => {
    invoke(200, { rid: (req) => (req as unknown as { id?: string }).id }, { id: 'req-77' } as Partial<Request>);
    await waitFor(() => server.requests.length === 1);
    expect(server.requests[0].query.get('rid')).toBe('req-77');
  });

  it('swallows a throwing rid callback and still pings', async () => {
    invoke(200, {
      rid: () => {
        throw new Error('bad rid');
      },
    });
    await waitFor(() => server.requests.length === 1);
    expect(server.requests[0].query.get('rid')).toBeNull();
    expect(server.requests[0].path).toBe('/api/signals/ping/tok');
  });

  it('pings only once even if finish fires twice', async () => {
    const job = createClient({ baseUrl: server.baseUrl }).registerJob('tok');
    const res = new FakeResponse();
    pingMiddleware(job)(({} as Request), res as unknown as Response, jest.fn());

    res.finish(200);
    res.emit('finish');
    await waitFor(() => server.requests.length === 1);
    // Give any erroneous second ping a chance to arrive.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(server.requests).toHaveLength(1);
  });

  it('never throws on the request path when the ping target is unreachable', async () => {
    await server.close();
    const job = createClient({ baseUrl: server.baseUrl, retries: 1, sleep: async () => undefined })
      .registerJob('tok');
    const res = new FakeResponse();
    const next = jest.fn();

    expect(() => {
      pingMiddleware(job)(({} as Request), res as unknown as Response, next);
      res.finish(200);
    }).not.toThrow();
    expect(next).toHaveBeenCalledTimes(1);
    // Let the swallowed (rejected) ping settle so no request stays in flight.
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
});
