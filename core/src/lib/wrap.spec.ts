import { IonhourClient } from './client';
import { IonhourUsageError } from './errors';
import { startTestServer, type TestServer } from './__testutils__/http-server';

describe('IonhourClient.wrap', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  function client() {
    // Deterministic monotonic clock: 1000ms then 1250ms (a 250ms duration).
    const ticks = [1000, 1250];
    let i = 0;
    return new IonhourClient({
      baseUrl: server.baseUrl,
      now: () => ticks[Math.min(i++, ticks.length - 1)],
    });
  }

  it('returns a function that runs fn, sends a start ping, then pings success with the duration', async () => {
    const wrapped = client().wrap('tok', () => 'done');
    const value = await wrapped();

    expect(value).toBe('done');
    expect(server.requests).toHaveLength(2);
    expect(server.requests[0].path).toBe('/api/signals/ping/tok/start');
    expect(server.requests[1].path).toBe('/api/signals/ping/tok');
    expect(server.requests[1].query.get('duration')).toBe('250');
  });

  it('passes arguments straight through to the wrapped function', async () => {
    const wrapped = client().wrap('tok', (a: number, b: number) => a + b);
    expect(await wrapped(2, 3)).toBe(5);
  });

  it('awaits an async fn and returns its resolved value', async () => {
    const wrapped = client().wrap('tok', async (n: number) => n * 10);
    expect(await wrapped(4)).toBe(40);
  });

  it('pings fail with the error message and rethrows on error', async () => {
    const boom = new Error('kaboom');
    const wrapped = client().wrap('tok', () => {
      throw boom;
    });

    await expect(wrapped()).rejects.toBe(boom);
    expect(server.requests).toHaveLength(2);
    expect(server.requests[0].path).toBe('/api/signals/ping/tok/start');
    expect(server.requests[1].path).toBe('/api/signals/ping/tok/fail');
    expect(server.requests[1].method).toBe('POST');
    expect(JSON.parse(server.requests[1].body)).toEqual({ error: 'kaboom' });
  });

  it('registers the job once — repeated invocations reuse the same registration', async () => {
    const wrapped = client().wrap('tok', (n: number) => n);
    await wrapped(1);
    await wrapped(2);

    // Two invocations => two start+terminal ping pairs, all under the same token.
    expect(server.requests).toHaveLength(4);
    expect(server.requests.every((r) => r.path.startsWith('/api/signals/ping/tok'))).toBe(true);
  });

  it('fails fast on an invalid token at wrap time (no ping sent)', () => {
    expect(() => client().wrap('bad token', () => 1)).toThrow(IonhourUsageError);
    expect(server.requests).toHaveLength(0);
  });

  it('forwards ping options (rid) onto both the start and success pings', async () => {
    const wrapped = client().wrap('tok', () => 'ok', { rid: 'run-7' });
    await wrapped();
    expect(server.requests[0].query.get('rid')).toBe('run-7'); // start
    expect(server.requests[1].query.get('rid')).toBe('run-7'); // success
  });

  it('forwards startPing:false through to run (no start ping)', async () => {
    const wrapped = client().wrap('tok', () => 'ok', { startPing: false });
    await wrapped();
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].path).toBe('/api/signals/ping/tok');
  });
});
