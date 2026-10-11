import { IonhourClient } from './client';
import { IonhourUsageError } from './errors';
import { MAX_ENV_LENGTH, MAX_HOST_LENGTH } from './constants';
import { startTestServer, type TestServer } from './__testutils__/http-server';

describe('IonhourJob.start', () => {
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

  it('sends a GET to the /start endpoint', async () => {
    const result = await job().start();

    expect(result).toEqual({ ok: true, status: 200 });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].method).toBe('GET');
    expect(server.requests[0].path).toBe('/api/signals/ping/tok/start');
    expect(server.requests[0].body).toBe('');
  });

  it('sends a POST to /start when a payload is present', async () => {
    await job().start({ payload: { region: 'eu' } });

    expect(server.requests[0].method).toBe('POST');
    expect(server.requests[0].path).toBe('/api/signals/ping/tok/start');
    expect(JSON.parse(server.requests[0].body)).toEqual({ region: 'eu' });
  });

  it('never rejects on transport failure', async () => {
    await server.close();
    const result = await new IonhourClient({
      baseUrl: server.baseUrl,
      retries: 1,
      sleep: async () => undefined,
    })
      .registerJob('tok')
      .start();

    expect(result.ok).toBe(false);
  });
});

describe('telemetry query params', () => {
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

  it('maps host/env/exitCode to host=/env=/exit_code= on a success ping', async () => {
    await job().success({ host: 'web-1.internal', env: 'production', exitCode: 0 });

    const { query } = server.requests[0];
    expect(query.get('host')).toBe('web-1.internal');
    expect(query.get('env')).toBe('production');
    expect(query.get('exit_code')).toBe('0');
  });

  it('maps the same params on a fail ping', async () => {
    await job().fail({ host: 'batch-9', env: 'staging', exitCode: 137 });

    const { query } = server.requests[0];
    expect(query.get('host')).toBe('batch-9');
    expect(query.get('env')).toBe('staging');
    expect(query.get('exit_code')).toBe('137');
  });

  it('omits the params entirely when not supplied', async () => {
    await job().success();

    const { query } = server.requests[0];
    expect(query.get('host')).toBeNull();
    expect(query.get('env')).toBeNull();
    expect(query.get('exit_code')).toBeNull();
  });

  it('accepts the exit-code boundaries 0 and 255', async () => {
    await job().success({ exitCode: 0 });
    await job().success({ exitCode: 255 });

    expect(server.requests[0].query.get('exit_code')).toBe('0');
    expect(server.requests[1].query.get('exit_code')).toBe('255');
  });
});

describe('exitCode usage errors', () => {
  const job = new IonhourClient({ baseUrl: 'http://127.0.0.1:1/api' }).registerJob('tok');

  it('rejects a non-integer exit code', async () => {
    await expect(job.success({ exitCode: 1.5 })).rejects.toThrow(IonhourUsageError);
  });

  it('rejects a negative exit code', async () => {
    await expect(job.success({ exitCode: -1 })).rejects.toThrow(IonhourUsageError);
  });

  it('rejects an exit code above 255', async () => {
    await expect(job.success({ exitCode: 256 })).rejects.toThrow(IonhourUsageError);
  });

  it('rejects a non-integer exit code on fail and start too', async () => {
    await expect(job.fail({ exitCode: NaN })).rejects.toThrow(IonhourUsageError);
    await expect(job.start({ exitCode: 3.14 })).rejects.toThrow(IonhourUsageError);
  });
});

describe('host/env truncation', () => {
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

  it('silently truncates an over-length host to 253 chars', async () => {
    const longHost = 'h'.repeat(MAX_HOST_LENGTH + 50);
    await job().success({ host: longHost });

    const sent = server.requests[0].query.get('host');
    expect(sent).toHaveLength(MAX_HOST_LENGTH);
    expect(sent).toBe('h'.repeat(MAX_HOST_LENGTH));
  });

  it('silently truncates an over-length env to 32 chars', async () => {
    const longEnv = 'e'.repeat(MAX_ENV_LENGTH + 50);
    await job().success({ env: longEnv });

    const sent = server.requests[0].query.get('env');
    expect(sent).toHaveLength(MAX_ENV_LENGTH);
  });

  it('leaves host/env untouched when within the limit', async () => {
    await job().success({ host: 'ok-host', env: 'prod' });

    expect(server.requests[0].query.get('host')).toBe('ok-host');
    expect(server.requests[0].query.get('env')).toBe('prod');
  });
});
