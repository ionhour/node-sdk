import { inspect } from 'node:util';
import { IonhourClient } from './client';
import { DEFAULT_API_BASE_URL } from './constants';
import { configure, registerJobBySlug, resetDefaultClient } from './default-client';
import { IonhourUsageError } from './errors';
import type { FetchLike, IonhourConfig, PingErrorContext } from './types';
import {
  startTestServer,
  unreachableBaseUrl,
  type Responder,
  type TestServer,
} from './__testutils__/http-server';

const API_KEY = 'ionh_live_SECRETSECRETSECRET';
const SECRET_TAIL = 'SECRETSECRETSECRET';

describe('slug mode', () => {
  let server: TestServer;
  let signalBase: string;
  let delays: number[];
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    // Token pings must never hit the API host; slug pings must never hit this.
    signalBase = await unreachableBaseUrl();
  });

  beforeEach(() => {
    delays = [];
    delete process.env['IONHOUR_API_KEY'];
    delete process.env['IONHOUR_API_BASE_URL'];
  });

  afterEach(async () => {
    process.env = { ...savedEnv };
    resetDefaultClient();
    if (server) {
      await server.close();
    }
  });

  async function withResponder(responder?: Responder): Promise<void> {
    server = await startTestServer(responder);
  }

  function client(extra?: Partial<IonhourConfig>): IonhourClient {
    return new IonhourClient({
      baseUrl: signalBase,
      apiBaseUrl: server.baseUrl,
      apiKey: API_KEY,
      sleep: async (ms) => {
        delays.push(ms);
      },
      ...extra,
    });
  }

  describe('wire protocol', () => {
    it('GETs {apiBaseUrl}/signals/s/{slug} with the Bearer key', async () => {
      await withResponder();

      const result = await client().registerJobBySlug('nightly-report').success();

      expect(result).toEqual({ ok: true, status: 200, created: false });
      expect(server.requests).toHaveLength(1);
      const [req] = server.requests;
      expect(req.method).toBe('GET');
      expect(req.path).toBe('/api/signals/s/nightly-report');
      expect(req.headers['authorization']).toBe(`Bearer ${API_KEY}`);
      expect(req.headers['user-agent']).toBe('ionhour-node/0.1.0');
      expect(req.query.has('create')).toBe(false);
    });

    it('routes fail and start to /fail and /start', async () => {
      await withResponder();
      const job = client().registerJobBySlug('etl_job');

      await job.fail();
      await job.start();

      expect(server.requests.map((r) => r.path)).toEqual([
        '/api/signals/s/etl_job/fail',
        '/api/signals/s/etl_job/start',
      ]);
      for (const req of server.requests) {
        expect(req.headers['authorization']).toBe(`Bearer ${API_KEY}`);
      }
    });

    it('POSTs a JSON payload', async () => {
      await withResponder();

      await client().registerJobBySlug('etl').success({ payload: { rows: 3 } });

      const [req] = server.requests;
      expect(req.method).toBe('POST');
      expect(req.headers['content-type']).toBe('application/json');
      expect(JSON.parse(req.body)).toEqual({ rows: 3 });
    });

    it('adds create=1 alongside the telemetry params when create is enabled', async () => {
      await withResponder();

      await client()
        .registerJobBySlug('etl', { create: true })
        .fail({ rid: 'r1', durationMs: 42, host: 'web-1', env: 'prod', exitCode: 2 });

      const [req] = server.requests;
      expect(req.query.get('create')).toBe('1');
      expect(req.query.get('rid')).toBe('r1');
      expect(req.query.get('duration')).toBe('42');
      expect(req.query.get('host')).toBe('web-1');
      expect(req.query.get('env')).toBe('prod');
      expect(req.query.get('exit_code')).toBe('2');
    });

    it('omits create when create is false', async () => {
      await withResponder();

      await client().registerJobBySlug('etl', { create: false }).success();

      expect(server.requests[0].query.has('create')).toBe(false);
    });

    it('reports created:true on a 201', async () => {
      await withResponder(() => ({
        status: 201,
        body: JSON.stringify({ message: 'OK', created: true }),
      }));

      const result = await client().registerJobBySlug('etl', { create: true }).success();

      expect(result).toEqual({ ok: true, status: 201, created: true });
    });

    it('reports created:true from the body even on a 200', async () => {
      await withResponder(() => ({ body: JSON.stringify({ message: 'OK', created: true }) }));

      const result = await client().registerJobBySlug('etl', { create: true }).success();

      expect(result.created).toBe(true);
    });

    it('runs fn under run() semantics with the Bearer key on start and terminal pings', async () => {
      await withResponder();

      const value = await client({ randomUUID: () => 'rid-1' })
        .registerJobBySlug('etl')
        .run(async () => 7);

      expect(value).toBe(7);
      expect(server.requests.map((r) => r.path)).toEqual([
        '/api/signals/s/etl/start',
        '/api/signals/s/etl',
      ]);
      expect(server.requests.every((r) => r.query.get('rid') === 'rid-1')).toBe(true);
      expect(server.requests.every((r) => r.headers['authorization'] === `Bearer ${API_KEY}`)).toBe(
        true,
      );
    });
  });

  describe('token pings stay credential-free', () => {
    it('never sends Authorization on token pings, even with apiKey configured', async () => {
      await withResponder();
      process.env['IONHOUR_API_KEY'] = 'ionh_from_env';
      const c = new IonhourClient({ baseUrl: server.baseUrl, apiKey: API_KEY });
      const job = c.registerJob('tok');

      await job.success();
      await job.fail();
      await job.start();
      await job.success({ payload: { a: 1 } });

      expect(server.requests).toHaveLength(4);
      for (const req of server.requests) {
        expect(req.path.startsWith('/api/signals/ping/tok')).toBe(true);
        expect(req.headers['authorization']).toBeUndefined();
      }
    });

    it('never parses an error envelope on the token path: plain "HTTP 403"', async () => {
      await withResponder(() => ({
        status: 403,
        body: JSON.stringify({ statusCode: 403, error: 'x', code: 'KEY_SCOPE_DENIED', message: 'no' }),
      }));

      const result = await new IonhourClient({ baseUrl: server.baseUrl, retries: 1 })
        .registerJob('tok')
        .success();

      expect(result).toEqual({ ok: false, status: 403, error: 'HTTP 403' });
    });

    it('never adds created to a token ping result', async () => {
      await withResponder(() => ({ status: 201, body: JSON.stringify({ created: true }) }));

      const result = await new IonhourClient({ baseUrl: server.baseUrl })
        .registerJob('tok')
        .success();

      expect(result).toEqual({ ok: true, status: 201 });
    });
  });

  describe('configuration', () => {
    it('defaults apiBaseUrl to the API host', () => {
      const c = new IonhourClient({ apiKey: API_KEY });
      expect(inspect(c.registerJobBySlug('etl'))).toContain(DEFAULT_API_BASE_URL);
      expect(DEFAULT_API_BASE_URL).toBe('https://api.ionhour.com/api');
    });

    it('reads apiBaseUrl and apiKey from IONHOUR_API_BASE_URL / IONHOUR_API_KEY', async () => {
      await withResponder();
      process.env['IONHOUR_API_BASE_URL'] = `${server.baseUrl}/`;
      process.env['IONHOUR_API_KEY'] = `  ${API_KEY}\n`;

      await new IonhourClient({ baseUrl: signalBase }).registerJobBySlug('etl').success();

      expect(server.requests[0].path).toBe('/api/signals/s/etl');
      expect(server.requests[0].headers['authorization']).toBe(`Bearer ${API_KEY}`);
    });

    it('prefers an explicit apiKey over the env and trims it', async () => {
      await withResponder();
      process.env['IONHOUR_API_KEY'] = 'ionh_env_key';

      await client({ apiKey: `  ${API_KEY}  ` }).registerJobBySlug('etl').success();

      expect(server.requests[0].headers['authorization']).toBe(`Bearer ${API_KEY}`);
    });

    it('treats a blank explicit apiKey as absent and falls back to the env', async () => {
      await withResponder();
      process.env['IONHOUR_API_KEY'] = API_KEY;

      await client({ apiKey: '   ' }).registerJobBySlug('etl').success();

      expect(server.requests[0].headers['authorization']).toBe(`Bearer ${API_KEY}`);
    });
  });

  describe('usage errors', () => {
    it.each([
      ['empty', ''],
      ['uppercase', 'Nightly'],
      ['too long', 'a'.repeat(65)],
      ['slash', 'a/b'],
      ['space', 'a b'],
      ['dot', 'a.b'],
      ['non-string', 42 as unknown as string],
    ])('rejects a %s slug', (_label, slug) => {
      const c = new IonhourClient({ apiKey: API_KEY });
      expect(() => c.registerJobBySlug(slug)).toThrow(IonhourUsageError);
    });

    it('accepts slugs at the pattern limits', () => {
      const c = new IonhourClient({ apiKey: API_KEY });
      expect(() => c.registerJobBySlug('a'.repeat(64))).not.toThrow();
      expect(() => c.registerJobBySlug('a')).not.toThrow();
      expect(() => c.registerJobBySlug('nightly_job-2')).not.toThrow();
    });

    it('throws at registration when no apiKey is configured', () => {
      const c = new IonhourClient();
      expect(() => c.registerJobBySlug('etl')).toThrow(IonhourUsageError);
      expect(() => c.registerJobBySlug('etl')).toThrow(/apiKey|IONHOUR_API_KEY/);
    });

    it('throws at registration when the apiKey is blank everywhere', () => {
      process.env['IONHOUR_API_KEY'] = '  ';
      const c = new IonhourClient({ apiKey: '' });
      expect(() => c.registerJobBySlug('etl')).toThrow(IonhourUsageError);
    });

    it('rejects an apiKey with inner whitespace without echoing it', () => {
      const c = new IonhourClient({ apiKey: 'ionh_abc\r\nX-Injected: 1' });
      let message = '';
      try {
        c.registerJobBySlug('etl');
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/apiKey/);
      expect(message).not.toContain('ionh_abc');
    });

    it('does not require an apiKey for token jobs', () => {
      expect(() => new IonhourClient().registerJob('tok')).not.toThrow();
    });
  });

  describe('retries', () => {
    it('retries a 429 then succeeds', async () => {
      await withResponder((_req, i) => ({ status: i === 0 ? 429 : 200 }));

      const result = await client().registerJobBySlug('etl').success();

      expect(result.ok).toBe(true);
      expect(server.requests).toHaveLength(2);
      expect(delays).toEqual([1000]);
    });

    it('retries a 5xx with the family backoff', async () => {
      await withResponder(() => ({ status: 502 }));

      const result = await client().registerJobBySlug('etl').success();

      expect(result.ok).toBe(false);
      expect(server.requests).toHaveLength(3);
      expect(delays).toEqual([1000, 2000]);
    });

    it.each([
      [400, 'VALIDATION_FAILED'],
      [401, 'MISSING_BEARER'],
      [401, 'SERVICE_KEY_INACTIVE'],
      [403, 'KEY_SCOPE_DENIED'],
      [403, 'INSUFFICIENT_ROLE'],
      [403, 'READ_ONLY_KEY'],
      [403, 'FEATURE_DISABLED'],
      [404, 'NOT_FOUND'],
    ])('does not retry a %i %s and surfaces the code', async (status, code) => {
      await withResponder(() => ({
        status,
        body: JSON.stringify({ statusCode: status, error: 'x', code, message: 'nope' }),
      }));
      const errors: Error[] = [];

      const result = await client({ onError: (e) => errors.push(e) })
        .registerJobBySlug('etl', { create: true })
        .success();

      expect(server.requests).toHaveLength(1);
      expect(delays).toEqual([]);
      expect(result).toEqual({ ok: false, status, error: `HTTP ${status} ${code}` });
      expect(errors[0].message).toBe(`HTTP ${status} ${code}`);
    });

    it('reads at most 4 KiB of a slug response body', async () => {
      // A code placed past the 4 KiB cap must never be seen: the body is cut
      // off before it, so the JSON fails to parse and no code is surfaced.
      const padding = 'x'.repeat(5_000);
      await withResponder(() => ({
        status: 403,
        body: `{"pad":"${padding}","code":"KEY_SCOPE_DENIED"}`,
      }));

      const result = await client().registerJobBySlug('etl').success();

      expect(result).toEqual({ ok: false, status: 403, error: 'HTTP 403' });
    });

    it('ignores a malformed or hostile error code in the body', async () => {
      await withResponder(() => ({
        status: 403,
        body: JSON.stringify({ code: `bad code ${API_KEY}` }),
      }));

      const result = await client().registerJobBySlug('etl').success();

      expect(result).toEqual({ ok: false, status: 403, error: 'HTTP 403' });
    });

    it('returns ok:false without throwing on a transport error', async () => {
      const apiBaseUrl = await unreachableBaseUrl();
      await withResponder();

      const result = await client({ apiBaseUrl, retries: 1 }).registerJobBySlug('etl').success();

      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe('redaction', () => {
    it('never shows the apiKey when the client is inspected or serialized', () => {
      const c = new IonhourClient({ apiKey: API_KEY });
      expect(inspect(c)).not.toContain(SECRET_TAIL);
      expect(JSON.stringify(c)).not.toContain(SECRET_TAIL);
    });

    it('never shows the apiKey when a slug job is inspected or serialized', () => {
      const job = new IonhourClient({ apiKey: API_KEY }).registerJobBySlug('etl');
      const shown = `${inspect(job)} ${JSON.stringify(job)}`;
      expect(shown).not.toContain(SECRET_TAIL);
      expect(shown).toContain('etl');
    });

    it('scrubs the apiKey out of transport-error text and the onError hook', async () => {
      await withResponder();
      const leakyFetch: FetchLike = async (_url, init) => {
        const auth = (init?.headers as Record<string, string>)['authorization'];
        throw new Error(`request failed with header ${auth}`);
      };
      const captured: Array<{ error: Error; ctx: PingErrorContext }> = [];

      const result = await client({
        fetch: leakyFetch,
        retries: 1,
        onError: (error, ctx) => captured.push({ error, ctx }),
      })
        .registerJobBySlug('etl')
        .fail();

      expect(result.ok).toBe(false);
      expect(result.error).not.toContain(SECRET_TAIL);
      expect(captured[0].error.message).not.toContain(SECRET_TAIL);
      expect(captured[0].ctx).toEqual({ slug: 'etl', fail: true });
      const ctx = captured[0].ctx;
      // Discriminated union: narrowing on `slug` makes `token` undefined.
      const label: string = ctx.slug !== undefined ? ctx.slug : ctx.token;
      expect(label).toBe('etl');
    });
  });

  describe('package-level registerJobBySlug', () => {
    it('registers on the default client', async () => {
      await withResponder();
      configure({ baseUrl: signalBase, apiBaseUrl: server.baseUrl, apiKey: API_KEY });

      const result = await registerJobBySlug('etl', { create: true }).success();

      expect(result.ok).toBe(true);
      expect(server.requests[0].path).toBe('/api/signals/s/etl');
      expect(server.requests[0].query.get('create')).toBe('1');
    });

    it('builds the default client from env', async () => {
      await withResponder();
      process.env['IONHOUR_API_BASE_URL'] = server.baseUrl;
      process.env['IONHOUR_API_KEY'] = API_KEY;

      await registerJobBySlug('etl').success();

      expect(server.requests[0].headers['authorization']).toBe(`Bearer ${API_KEY}`);
    });
  });
});
