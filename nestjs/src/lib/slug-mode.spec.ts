import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IonhourUsageError } from '@ionhour/core';
import { IonhourJob } from './ionhour-job.decorator';
import { IonhourModule } from './ionhour.module';
import { IonhourService } from './ionhour.service';
import { resetIonhourRegistry } from './registry';
import type { IonhourModuleOptions } from './types';
import { startTestServer, type TestServer } from './__testutils__/http-server';

const API_KEY = 'ionh_nest_SECRETSECRET';

describe('slug mode (NestJS)', () => {
  let signal: TestServer;
  let api: TestServer;
  let app: INestApplication | undefined;
  const savedKey = process.env['IONHOUR_API_KEY'];

  beforeEach(async () => {
    resetIonhourRegistry();
    delete process.env['IONHOUR_API_KEY'];
    signal = await startTestServer();
    api = await startTestServer((req) =>
      req.query.get('create') === '1'
        ? { status: 201, body: JSON.stringify({ message: 'OK', created: true }) }
        : {},
    );
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    await signal.close();
    await api.close();
    if (savedKey === undefined) {
      delete process.env['IONHOUR_API_KEY'];
    } else {
      process.env['IONHOUR_API_KEY'] = savedKey;
    }
  });

  async function bootstrap(extra: IonhourModuleOptions = {}): Promise<IonhourService> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        IonhourModule.forRoot({
          baseUrl: signal.baseUrl,
          apiBaseUrl: api.baseUrl,
          apiKey: API_KEY,
          ...extra,
        }),
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    return app.get(IonhourService);
  }

  describe('IonhourService.registerJobBySlug', () => {
    it('pings the API host with the Bearer key and create=1', async () => {
      const service = await bootstrap();

      const result = await service.registerJobBySlug('etl', { create: true }).success();

      expect(result).toEqual({ ok: true, status: 201, created: true });
      expect(signal.requests).toHaveLength(0);
      const [req] = api.requests;
      expect(req.path).toBe('/api/signals/s/etl');
      expect(req.query.get('create')).toBe('1');
      expect(req.headers['authorization']).toBe(`Bearer ${API_KEY}`);
    });

    it('throws a usage error at registration when no apiKey is configured', async () => {
      const service = await bootstrap({ apiKey: undefined });

      expect(() => service.registerJobBySlug('etl')).toThrow(IonhourUsageError);
    });

    it('keeps token pings credential-free when an apiKey is configured', async () => {
      const service = await bootstrap();

      await service.success('tok');
      await service.fail('tok');

      expect(signal.requests).toHaveLength(2);
      for (const req of signal.requests) {
        expect(req.headers['authorization']).toBeUndefined();
      }
      expect(api.requests).toHaveLength(0);
    });
  });

  describe('@IonhourJob({ slug })', () => {
    it('runs the method under run() semantics against the slug routes', async () => {
      await bootstrap();

      class Worker {
        @IonhourJob({ slug: 'nightly', create: true }, { env: 'production' })
        async work(): Promise<string> {
          return 'ok';
        }
      }

      await expect(new Worker().work()).resolves.toBe('ok');

      expect(api.requests.map((r) => r.path)).toEqual([
        '/api/signals/s/nightly/start',
        '/api/signals/s/nightly',
      ]);
      for (const req of api.requests) {
        expect(req.headers['authorization']).toBe(`Bearer ${API_KEY}`);
        expect(req.query.get('create')).toBe('1');
        expect(req.query.get('env')).toBe('production');
      }
      expect(signal.requests).toHaveLength(0);
    });

    it('pings /fail and rethrows when the method throws', async () => {
      await bootstrap();
      const boom = new Error('cron failed');

      class Worker {
        @IonhourJob({ slug: 'nightly' })
        async work(): Promise<void> {
          throw boom;
        }
      }

      await expect(new Worker().work()).rejects.toBe(boom);
      expect(api.requests[1].path).toBe('/api/signals/s/nightly/fail');
      expect(api.requests[1].query.has('create')).toBe(false);
    });

    it('still runs the method and warns once when the module has no apiKey', async () => {
      await bootstrap({ apiKey: undefined });
      const warn = jest.fn();

      class Worker {
        ran = 0;

        @IonhourJob({ slug: 'nightly', create: true }, { logger: { warn } })
        async work(): Promise<string> {
          this.ran += 1;
          return 'done';
        }
      }

      const worker = new Worker();
      await expect(worker.work()).resolves.toBe('done');
      await expect(worker.work()).resolves.toBe('done');

      expect(worker.ran).toBe(2);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('pings disabled');
      expect(warn.mock.calls[0][0]).toContain('nightly');
      expect(api.requests).toHaveLength(0);
      expect(signal.requests).toHaveLength(0);
    });

    it('rejects an invalid slug loudly at class definition', () => {
      expect(() => {
        class Worker {
          @IonhourJob({ slug: 'Not Valid' })
          async work(): Promise<void> {
            return undefined;
          }
        }
        return Worker;
      }).toThrow(IonhourUsageError);
    });

    it('warns once naming the slug when the module is not initialized', async () => {
      const warn = jest.fn();

      class Worker {
        @IonhourJob({ slug: 'nightly' }, { logger: { warn } })
        async work(): Promise<string> {
          return 'done';
        }
      }

      await expect(new Worker().work()).resolves.toBe('done');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('nightly');
    });
  });

  it('token pings returning a 403 envelope yield plain "HTTP 403"', async () => {
    const forbidden = await startTestServer(() => ({
      status: 403,
      body: JSON.stringify({ statusCode: 403, error: 'x', code: 'KEY_SCOPE_DENIED', message: 'no' }),
    }));
    try {
      const service = await bootstrap({ baseUrl: forbidden.baseUrl });
      expect(await service.success('tok')).toEqual({ ok: false, status: 403, error: 'HTTP 403' });
    } finally {
      await forbidden.close();
    }
  });

  it('never writes the full job token in the not-initialized warning', async () => {
    const warn = jest.fn();
    const token = 'tok_0123456789abcdefSECRET';

    class Worker {
      @IonhourJob(token, { logger: { warn } })
      async work(): Promise<string> {
        return 'done';
      }
    }

    await new Worker().work();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).not.toContain(token);
    expect(warn.mock.calls[0][0]).not.toContain('SECRET');
  });
});
