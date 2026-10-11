import { IonhourClient } from './client';
import { IonhourUsageError } from './errors';
import { startTestServer, type TestServer } from './__testutils__/http-server';

describe('IonhourClient.registerJob validation', () => {
  const client = new IonhourClient({ baseUrl: 'http://127.0.0.1:1/api' });

  it('rejects an empty token', () => {
    expect(() => client.registerJob('')).toThrow(IonhourUsageError);
  });

  it('rejects a whitespace-containing token', () => {
    expect(() => client.registerJob('abc def')).toThrow(/whitespace/);
    expect(() => client.registerJob('abc\tdef')).toThrow(IonhourUsageError);
    expect(() => client.registerJob(' abc')).toThrow(IonhourUsageError);
  });

  it('accepts a valid token and performs no network call', () => {
    const job = client.registerJob('tok-123');
    expect(job).toBeDefined();
  });
});

describe('IonhourClient config validation', () => {
  it('rejects a non-positive timeout', () => {
    expect(() => new IonhourClient({ timeout: 0 })).toThrow(IonhourUsageError);
    expect(() => new IonhourClient({ timeout: -5 })).toThrow(IonhourUsageError);
  });

  it('rejects retries below 1 or non-integer', () => {
    expect(() => new IonhourClient({ retries: 0 })).toThrow(IonhourUsageError);
    expect(() => new IonhourClient({ retries: 2.5 })).toThrow(IonhourUsageError);
  });
});

describe('IonhourClient environment fallbacks', () => {
  let server: TestServer;
  const originalKey = process.env['IONHOUR_API_KEY'];
  const originalBase = process.env['IONHOUR_BASE_URL'];

  beforeEach(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    if (originalKey === undefined) {
      delete process.env['IONHOUR_API_KEY'];
    } else {
      process.env['IONHOUR_API_KEY'] = originalKey;
    }
    if (originalBase === undefined) {
      delete process.env['IONHOUR_BASE_URL'];
    } else {
      process.env['IONHOUR_BASE_URL'] = originalBase;
    }
    await server.close();
  });

  it('reads the base URL from the environment', async () => {
    process.env['IONHOUR_BASE_URL'] = server.baseUrl;

    const client = new IonhourClient();
    const result = await client.registerJob('tok').success();

    expect(result.ok).toBe(true);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].path).toBe('/api/signals/ping/tok');
  });

  it('ignores a stray IONHOUR_API_KEY: no Authorization header is sent', async () => {
    process.env['IONHOUR_BASE_URL'] = server.baseUrl;
    process.env['IONHOUR_API_KEY'] = 'ionh_env-key';

    await new IonhourClient().registerJob('tok').success();

    expect(server.requests[0].headers['authorization']).toBeUndefined();
  });

  it('strips a trailing slash from the base URL', async () => {
    const client = new IonhourClient({ baseUrl: `${server.baseUrl}/` });
    await client.registerJob('tok').success();
    expect(server.requests[0].path).toBe('/api/signals/ping/tok');
  });
});
