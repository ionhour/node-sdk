import { IonhourClient } from './client';
import { startTestServer, type TestServer } from './__testutils__/http-server';

describe('IonhourJob ping wire protocol', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  function client() {
    return new IonhourClient({ baseUrl: server.baseUrl });
  }

  it('sends a GET success ping when there is no payload', async () => {
    const result = await client().registerJob('tok').success();

    expect(result).toEqual({ ok: true, status: 200 });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].method).toBe('GET');
    expect(server.requests[0].path).toBe('/api/signals/ping/tok');
    expect(server.requests[0].body).toBe('');
    expect(server.requests[0].headers['user-agent']).toBe('ionhour-node/0.1.0');
  });

  it('sends a POST JSON success ping when a payload is present', async () => {
    const payload = { region: 'eu', items: 3 };
    const result = await client().registerJob('tok').success({ payload });

    expect(result.ok).toBe(true);
    expect(server.requests[0].method).toBe('POST');
    expect(server.requests[0].headers['content-type']).toBe('application/json');
    expect(JSON.parse(server.requests[0].body)).toEqual(payload);
  });

  it('sends a failure ping to the /fail path', async () => {
    await client().registerJob('tok').fail();
    expect(server.requests[0].path).toBe('/api/signals/ping/tok/fail');
  });

  it('sends a failure ping with a payload via POST', async () => {
    await client().registerJob('tok').fail({ payload: { error: 'boom' } });
    expect(server.requests[0].method).toBe('POST');
    expect(server.requests[0].path).toBe('/api/signals/ping/tok/fail');
    expect(JSON.parse(server.requests[0].body)).toEqual({ error: 'boom' });
  });

  it('attaches rid and duration query params', async () => {
    await client().registerJob('tok').success({ rid: 'run-42', durationMs: 128 });
    const { query } = server.requests[0];
    expect(query.get('rid')).toBe('run-42');
    expect(query.get('duration')).toBe('128');
  });

  it('exposes ping() as an alias for success()', async () => {
    await client().registerJob('tok').ping();
    expect(server.requests[0].path).toBe('/api/signals/ping/tok');
    expect(server.requests[0].method).toBe('GET');
  });

  it('URL-encodes a token so special characters reach the server intact', async () => {
    // Without encoding, '#' would start a URL fragment and truncate the path.
    await client().registerJob('tok#1').success();
    expect(server.requests[0].path).toBe('/api/signals/ping/tok%231');
  });

  it('never sends an Authorization header on success, fail, or start pings', async () => {
    // Protected jobs are not enforced yet (spec 027); heartbeat pings carry no
    // credential beyond the token in the path.
    const job = client().registerJob('tok');
    await job.success();
    await job.fail();
    await job.start();

    expect(server.requests).toHaveLength(3);
    for (const request of server.requests) {
      expect(request.headers['authorization']).toBeUndefined();
    }
  });
});
