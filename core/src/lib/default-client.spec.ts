import { IonhourClient } from './client';
import { IonhourUsageError } from './errors';
import { configure, registerJob, resetDefaultClient, wrap } from './default-client';
import { startTestServer, type TestServer } from './__testutils__/http-server';

describe('package-level default client', () => {
  let server: TestServer;
  const originalBase = process.env['IONHOUR_BASE_URL'];

  beforeEach(async () => {
    resetDefaultClient();
    server = await startTestServer();
  });

  afterEach(async () => {
    resetDefaultClient();
    restoreEnv('IONHOUR_BASE_URL', originalBase);
    await server.close();
  });

  function restoreEnv(name: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  describe('registerJob (lazy, env-configured client)', () => {
    it('lazily creates a client from env when configure was never called', async () => {
      process.env['IONHOUR_BASE_URL'] = server.baseUrl;

      const result = await registerJob('tok').success();

      expect(result.ok).toBe(true);
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0].path).toBe('/api/signals/ping/tok');
    });

    it('reuses the same lazily-created client across calls', async () => {
      process.env['IONHOUR_BASE_URL'] = server.baseUrl;

      await registerJob('a').success();
      await registerJob('b').success();

      expect(server.requests).toHaveLength(2);
    });

    it('validates the token and throws at registration', () => {
      process.env['IONHOUR_BASE_URL'] = server.baseUrl;
      expect(() => registerJob('bad token')).toThrow(IonhourUsageError);
    });
  });

  describe('configure', () => {
    it('returns a client and routes package-level pings through its config', async () => {
      const client = configure({ baseUrl: server.baseUrl, userAgent: 'cfg-agent' });
      expect(client).toBeInstanceOf(IonhourClient);

      await registerJob('tok').success();

      expect(server.requests[0].headers['user-agent']).toBe('cfg-agent');
    });

    it('replaces the existing default client', async () => {
      const other = await startTestServer();
      try {
        configure({ baseUrl: server.baseUrl });
        await registerJob('first').success();

        configure({ baseUrl: other.baseUrl });
        await registerJob('second').success();

        expect(server.requests).toHaveLength(1);
        expect(server.requests[0].path).toBe('/api/signals/ping/first');
        expect(other.requests).toHaveLength(1);
        expect(other.requests[0].path).toBe('/api/signals/ping/second');
      } finally {
        await other.close();
      }
    });
  });

  describe('resetDefaultClient', () => {
    it('drops the client so the next call rebuilds from current env', async () => {
      const first = await startTestServer();
      configure({ baseUrl: first.baseUrl });
      await registerJob('tok').success();
      expect(first.requests).toHaveLength(1);
      await first.close();

      resetDefaultClient();
      process.env['IONHOUR_BASE_URL'] = server.baseUrl;
      await registerJob('tok').success();

      expect(server.requests).toHaveLength(1);
    });
  });

  describe('package-level wrap', () => {
    it('wraps a function via the default client', async () => {
      process.env['IONHOUR_BASE_URL'] = server.baseUrl;

      const wrapped = wrap('tok', (n: number) => n * 2);
      const value = await wrapped(21);

      expect(value).toBe(42);
      expect(server.requests[0].path).toBe('/api/signals/ping/tok/start');
      expect(server.requests[1].path).toBe('/api/signals/ping/tok');
      expect(server.requests[1].query.get('duration')).not.toBeNull();
    });

    it('rethrows fn errors after a fail ping via the default client', async () => {
      process.env['IONHOUR_BASE_URL'] = server.baseUrl;

      const wrapped = wrap('tok', () => {
        throw new Error('boom');
      });

      await expect(wrapped()).rejects.toThrow('boom');
      expect(server.requests[0].path).toBe('/api/signals/ping/tok/start');
      expect(server.requests[1].path).toBe('/api/signals/ping/tok/fail');
    });

    it('binds to the default client at creation time — a later configure does not rebind', async () => {
      const other = await startTestServer();
      try {
        configure({ baseUrl: server.baseUrl });
        const wrapped = wrap('tok', () => 'ok');

        // Reconfigure AFTER the wrapper exists: it must keep using the old client.
        configure({ baseUrl: other.baseUrl });
        await wrapped();

        // Start + success both go to the pre-configure client; the new one is untouched.
        expect(server.requests).toHaveLength(2);
        expect(server.requests.every((r) => r.path.startsWith('/api/signals/ping/tok'))).toBe(true);
        expect(other.requests).toHaveLength(0);
      } finally {
        await other.close();
      }
    });
  });

  describe('failed configure', () => {
    it('throws on invalid config and leaves the previous default client intact', async () => {
      configure({ baseUrl: server.baseUrl });

      // `new IonhourClient` throws before the assignment, so the prior client stays.
      expect(() => configure({ timeout: 0 })).toThrow(IonhourUsageError);

      await registerJob('tok').success();
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0].path).toBe('/api/signals/ping/tok');
    });
  });
});
