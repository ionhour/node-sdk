import {
  IonhourClient,
  IonhourUsageError,
  configure,
  createClient,
  pingMiddleware,
  registerJob,
  resetDefaultClient,
  wrap,
} from '../index';
import { startTestServer, type TestServer } from './__testutils__/http-server';

describe('@ionhour/express barrel exports', () => {
  it('re-exports the core client and errors', () => {
    expect(typeof IonhourClient).toBe('function');
    expect(typeof IonhourUsageError).toBe('function');
    expect(typeof pingMiddleware).toBe('function');
    expect(typeof createClient).toBe('function');
  });

  it('re-exports the core package-level default-client helpers', () => {
    // `export * from '@ionhour/core'` must carry the shortest-path surface
    // through without conflicting with createClient / pingMiddleware.
    expect(typeof configure).toBe('function');
    expect(typeof registerJob).toBe('function');
    expect(typeof wrap).toBe('function');
    expect(typeof resetDefaultClient).toBe('function');
  });
});

describe('createClient', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('returns an IonhourClient whose jobs reach the configured base URL', async () => {
    const client = createClient({ baseUrl: server.baseUrl });
    expect(client).toBeInstanceOf(IonhourClient);

    const result = await client.registerJob('tok').success();
    expect(result.ok).toBe(true);
    expect(server.requests[0].path).toBe('/api/signals/ping/tok');
  });
});
