import { inspect } from 'node:util';
import { IonhourClient } from './client';
import type { IonhourConfig } from './types';
import { startTestServer, type TestServer } from './__testutils__/http-server';

describe('legacy apiKey input', () => {
  let server: TestServer;

  beforeEach(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('ignores an apiKey passed by an untyped (JS) caller: no Authorization header', async () => {
    // The option was removed before first publish because no ping route
    // enforces it. A JS caller still passing it must not get a Bearer header.
    const legacyConfig = { baseUrl: server.baseUrl, apiKey: 'ionh_legacy' } as IonhourConfig;
    const client = new IonhourClient(legacyConfig);

    await client.registerJob('tok').success();

    expect(server.requests[0].headers['authorization']).toBeUndefined();
  });
});

describe('credential redaction', () => {
  const client = new IonhourClient({ baseUrl: 'http://127.0.0.1:1/api' });
  const job = client.registerJob('super-secret-token');

  it('never leaks the token via util.inspect(job)', () => {
    const output = inspect(job);
    expect(output).not.toContain('super-secret-token');
    expect(output).toContain('<redacted>');
  });

  it('never leaks the token via JSON.stringify(job)', () => {
    expect(JSON.stringify(job)).not.toContain('super-secret-token');
  });

  it('exposes no apiKey field when a client is inspected or serialized', () => {
    expect(inspect(client)).not.toContain('apiKey');
    expect(JSON.stringify(client)).not.toContain('apiKey');
  });
});
