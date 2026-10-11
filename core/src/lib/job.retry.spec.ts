import { IonhourClient } from './client';
import type { IonhourConfig } from './types';
import {
  startTestServer,
  unreachableBaseUrl,
  type Responder,
  type TestServer,
} from './__testutils__/http-server';

describe('IonhourJob retry behaviour', () => {
  let server: TestServer;
  let delays: number[];

  beforeEach(() => {
    delays = [];
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
  });

  /** Client whose backoff resolves instantly but records the requested delays. */
  function client(extra?: Partial<IonhourConfig>) {
    return new IonhourClient({
      baseUrl: server.baseUrl,
      sleep: async (ms) => {
        delays.push(ms);
      },
      ...extra,
    });
  }

  async function withResponder(responder: Responder) {
    server = await startTestServer(responder);
  }

  it('retries once on 500 then succeeds, using a 1s backoff', async () => {
    await withResponder((_req, i) => ({ status: i === 0 ? 500 : 200 }));

    const result = await client().registerJob('tok').success();

    expect(result.ok).toBe(true);
    expect(server.requests).toHaveLength(2);
    expect(delays).toEqual([1000]);
  });

  it('retries on 429 then succeeds', async () => {
    await withResponder((_req, i) => ({ status: i === 0 ? 429 : 200 }));

    const result = await client().registerJob('tok').success();

    expect(result.ok).toBe(true);
    expect(server.requests).toHaveLength(2);
  });

  it('backs off 1s then 2s across two retries before giving up', async () => {
    await withResponder(() => ({ status: 503 }));

    const result = await client().registerJob('tok').success();

    expect(result).toEqual({ ok: false, status: 503, error: 'HTTP 503' });
    expect(server.requests).toHaveLength(3);
    expect(delays).toEqual([1000, 2000]);
  });

  it('clamps the backoff at 2s for every wait after the first (never grows)', async () => {
    // Contract: 1s, then 2s for every subsequent wait — never linear/exponential.
    await withResponder(() => ({ status: 503 }));

    const result = await client({ retries: 5 }).registerJob('tok').success();

    expect(result.ok).toBe(false);
    expect(server.requests).toHaveLength(5);
    // Four waits across five attempts: the 3rd and 4th (the "4th+ attempt")
    // must still be 2s, proving the schedule is clamped, not growing.
    expect(delays).toEqual([1000, 2000, 2000, 2000]);
  });

  it('does not retry on a 400', async () => {
    await withResponder(() => ({ status: 400 }));

    const result = await client().registerJob('tok').success();

    expect(result).toEqual({ ok: false, status: 400, error: 'HTTP 400' });
    expect(server.requests).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it('returns ok:false without throwing on a transport error', async () => {
    const baseUrl = await unreachableBaseUrl();
    const errors: Error[] = [];
    const c = new IonhourClient({
      baseUrl,
      retries: 1,
      sleep: async () => undefined,
      onError: (err) => errors.push(err),
    });

    const result = await c.registerJob('tok').success();

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(errors).toHaveLength(1);
  });

  it('returns ok:false when every attempt times out', async () => {
    // Responder that never calls end() -> the request hangs until aborted.
    server = await startTestServer(() => ({ status: 200 }));
    // Replace the handler with a hanging one by pointing at a fresh hanging server.
    await server.close();
    server = await startHangingServer();

    const c = new IonhourClient({
      baseUrl: server.baseUrl,
      timeout: 40,
      retries: 1,
      sleep: async () => undefined,
    });

    const result = await c.registerJob('tok').success();
    expect(result.ok).toBe(false);
  });
});

/** A server that accepts the request but never responds, forcing a timeout. */
async function startHangingServer(): Promise<TestServer> {
  const { createServer } = await import('node:http');
  const { Socket } = await import('node:net');
  const sockets = new Set<InstanceType<typeof Socket>>();
  const server = createServer(() => {
    /* intentionally never responds */
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}/api`,
    requests: [],
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
