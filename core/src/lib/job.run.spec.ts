import { IonhourClient } from './client';
import { IonhourUsageError } from './errors';
import { startTestServer, type TestServer } from './__testutils__/http-server';

describe('IonhourJob.run', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  function client() {
    // Deterministic monotonic clock: 0ms then 250ms.
    const ticks = [1000, 1250];
    let i = 0;
    return new IonhourClient({
      baseUrl: server.baseUrl,
      now: () => ticks[Math.min(i++, ticks.length - 1)],
    });
  }

  it('sends a start ping, then pings success with the measured duration and returns fn result', async () => {
    const value = await client()
      .registerJob('tok')
      .run(() => 'done');

    expect(value).toBe('done');
    expect(server.requests).toHaveLength(2);
    expect(server.requests[0].path).toBe('/api/signals/ping/tok/start');
    expect(server.requests[1].path).toBe('/api/signals/ping/tok');
    expect(server.requests[1].query.get('duration')).toBe('250');
  });

  it('awaits an async fn and returns its resolved value', async () => {
    const value = await client()
      .registerJob('tok')
      .run(async () => 42);

    expect(value).toBe(42);
    expect(server.requests[1].method).toBe('GET');
  });

  it('pings fail with the error message and rethrows on error', async () => {
    const job = client().registerJob('tok');
    const boom = new Error('kaboom');

    await expect(
      job.run(() => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    expect(server.requests).toHaveLength(2);
    expect(server.requests[0].path).toBe('/api/signals/ping/tok/start');
    expect(server.requests[1].path).toBe('/api/signals/ping/tok/fail');
    expect(server.requests[1].method).toBe('POST');
    expect(JSON.parse(server.requests[1].body)).toEqual({ error: 'kaboom' });
  });

  it('merges the error into a user-supplied object payload', async () => {
    const job = client().registerJob('tok');

    await expect(
      job.run(
        () => {
          throw new Error('down');
        },
        { payload: { service: 'billing' } },
      ),
    ).rejects.toThrow('down');

    expect(JSON.parse(server.requests[1].body)).toEqual({
      service: 'billing',
      error: 'down',
    });
  });

  it('does not throw a ping-transport error out of run (still rethrows fn error)', async () => {
    await server.close();
    const c = new IonhourClient({
      baseUrl: server.baseUrl,
      retries: 1,
      sleep: async () => undefined,
    });

    // Server is closed: the fail ping will error, but run must surface fn's error.
    await expect(
      c.registerJob('tok').run(() => {
        throw new Error('app-error');
      }),
    ).rejects.toThrow('app-error');
  });
});

describe('IonhourJob.run start ping', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  /** Client with a deterministic run-id generator so correlation is assertable. */
  function client(rid = 'gen-rid-1') {
    return new IonhourClient({ baseUrl: server.baseUrl, randomUUID: () => rid });
  }

  it('correlates the start and terminal pings with the same generated rid', async () => {
    await client().registerJob('tok').run(() => 'ok');

    expect(server.requests).toHaveLength(2);
    expect(server.requests[0].path).toBe('/api/signals/ping/tok/start');
    expect(server.requests[0].query.get('rid')).toBe('gen-rid-1');
    expect(server.requests[1].path).toBe('/api/signals/ping/tok');
    expect(server.requests[1].query.get('rid')).toBe('gen-rid-1');
  });

  it('correlates the start and fail pings with the same generated rid', async () => {
    await expect(
      client().registerJob('tok').run(() => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(server.requests[0].path).toBe('/api/signals/ping/tok/start');
    expect(server.requests[0].query.get('rid')).toBe('gen-rid-1');
    expect(server.requests[1].path).toBe('/api/signals/ping/tok/fail');
    expect(server.requests[1].query.get('rid')).toBe('gen-rid-1');
  });

  it('preserves a caller-supplied rid on both pings instead of generating one', async () => {
    await client().registerJob('tok').run(() => 'ok', { rid: 'caller-rid' });

    expect(server.requests[0].query.get('rid')).toBe('caller-rid');
    expect(server.requests[1].query.get('rid')).toBe('caller-rid');
  });

  it('carries only rid/host/env on the start ping (no duration/exitCode/payload)', async () => {
    await client()
      .registerJob('tok')
      .run(() => 'ok', { host: 'web-1', env: 'production', exitCode: 0, payload: { a: 1 } });

    const startReq = server.requests[0];
    expect(startReq.path).toBe('/api/signals/ping/tok/start');
    expect(startReq.method).toBe('GET');
    expect(startReq.body).toBe('');
    expect(startReq.query.get('host')).toBe('web-1');
    expect(startReq.query.get('env')).toBe('production');
    expect(startReq.query.get('duration')).toBeNull();
    expect(startReq.query.get('exit_code')).toBeNull();
  });

  it('sends no start ping when startPing is false', async () => {
    await client().registerJob('tok').run(() => 'ok', { startPing: false });

    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].path).toBe('/api/signals/ping/tok');
  });

  it('does not auto-generate a rid when the start ping is disabled', async () => {
    await client().registerJob('tok').run(() => 'ok', { startPing: false });

    expect(server.requests[0].query.get('rid')).toBeNull();
  });

  it('a failing start ping affects neither fn nor the terminal ping', async () => {
    // Start ping 500s (retryable, exhausts), fn still runs, success ping still lands.
    let call = 0;
    const failingStart = await startTestServer((req) => {
      call += 1;
      return { status: req.path.endsWith('/start') ? 500 : 200 };
    });
    try {
      const c = new IonhourClient({
        baseUrl: failingStart.baseUrl,
        retries: 1,
        sleep: async () => undefined,
        randomUUID: () => 'gen-rid-1',
      });

      const value = await c.registerJob('tok').run(() => 'result');

      expect(value).toBe('result');
      const paths = failingStart.requests.map((r) => r.path);
      expect(paths).toContain('/api/signals/ping/tok/start');
      expect(paths).toContain('/api/signals/ping/tok');
      expect(call).toBeGreaterThanOrEqual(2);
    } finally {
      await failingStart.close();
    }
  });
});

describe('IonhourJob payload validation', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  function job() {
    return new IonhourClient({ baseUrl: server.baseUrl }).registerJob('tok');
  }

  it('rejects a payload larger than 10 KiB before sending', async () => {
    const payload = { blob: 'x'.repeat(11_000) };
    await expect(job().success({ payload })).rejects.toThrow(IonhourUsageError);
    expect(server.requests).toHaveLength(0);
  });

  it('rejects a non-serializable payload', async () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    await expect(job().success({ payload: circular })).rejects.toThrow(IonhourUsageError);
    expect(server.requests).toHaveLength(0);
  });

  it('accepts a payload at exactly the byte limit', async () => {
    // {"blob":"..."} overhead is 11 bytes, so pad to fill 10240 exactly.
    const filler = 'x'.repeat(10_240 - 11);
    const result = await job().success({ payload: { blob: filler } });
    expect(result.ok).toBe(true);
  });
});
