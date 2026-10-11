import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import {
  IonhourUsageError,
  configure,
  createClient,
  pingMiddleware,
  registerJobBySlug,
  resetDefaultClient,
} from '../index';
import { startTestServer, waitFor, type TestServer } from './__testutils__/http-server';

const API_KEY = 'ionh_express_SECRETSECRET';

class FakeResponse extends EventEmitter {
  statusCode = 200;
  finish(status: number): void {
    this.statusCode = status;
    this.emit('finish');
  }
}

describe('slug mode (Express)', () => {
  let api: TestServer;
  let signal: TestServer;

  beforeEach(async () => {
    api = await startTestServer();
    signal = await startTestServer();
  });

  afterEach(async () => {
    resetDefaultClient();
    await api.close();
    await signal.close();
  });

  function slugClient() {
    return createClient({ baseUrl: signal.baseUrl, apiBaseUrl: api.baseUrl, apiKey: API_KEY });
  }

  it('re-exports the package-level registerJobBySlug', () => {
    expect(typeof registerJobBySlug).toBe('function');
  });

  it('pingMiddleware pings a slug job on the API host with the Bearer key', async () => {
    const job = slugClient().registerJobBySlug('checkout', { create: true });
    const res = new FakeResponse();
    const next: NextFunction = jest.fn();

    pingMiddleware(job)({} as Request, res as unknown as Response, next);
    res.finish(503);
    await waitFor(() => api.requests.length === 1);

    const [req] = api.requests;
    expect(req.path).toBe('/api/signals/s/checkout/fail');
    expect(req.query.get('create')).toBe('1');
    expect(req.query.get('duration')).not.toBeNull();
    expect(req.headers['authorization']).toBe(`Bearer ${API_KEY}`);
    expect(signal.requests).toHaveLength(0);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('keeps token-job middleware pings credential-free on the same client', async () => {
    const job = slugClient().registerJob('tok');
    const res = new FakeResponse();

    pingMiddleware(job)({} as Request, res as unknown as Response, jest.fn());
    res.finish(200);
    await waitFor(() => signal.requests.length === 1);

    expect(signal.requests[0].headers['authorization']).toBeUndefined();
    expect(api.requests).toHaveLength(0);
  });

  it('package-level registerJobBySlug uses configure()', async () => {
    configure({ apiBaseUrl: api.baseUrl, apiKey: API_KEY });

    const result = await registerJobBySlug('checkout').success();

    expect(result).toEqual({ ok: true, status: 200, created: false });
    expect(api.requests[0].headers['authorization']).toBe(`Bearer ${API_KEY}`);
  });

  it('token pings returning a 403 envelope yield plain "HTTP 403"', async () => {
    const forbidden = await startTestServer(() => ({
      status: 403,
      body: JSON.stringify({ statusCode: 403, error: 'x', code: 'KEY_SCOPE_DENIED', message: 'no' }),
    }));
    try {
      const result = await createClient({ baseUrl: forbidden.baseUrl, apiKey: API_KEY })
        .registerJob('tok')
        .success();
      expect(result).toEqual({ ok: false, status: 403, error: 'HTTP 403' });
    } finally {
      await forbidden.close();
    }
  });

  it('fails loudly at registration without an apiKey', () => {
    const saved = process.env['IONHOUR_API_KEY'];
    delete process.env['IONHOUR_API_KEY'];
    try {
      expect(() => createClient().registerJobBySlug('checkout')).toThrow(IonhourUsageError);
    } finally {
      if (saved !== undefined) {
        process.env['IONHOUR_API_KEY'] = saved;
      }
    }
  });
});
