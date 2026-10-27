import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IonhourJob } from './ionhour-job.decorator';
import { IonhourModule } from './ionhour.module';
import { resetIonhourRegistry } from './registry';
import { startTestServer, type TestServer } from './__testutils__/http-server';

describe('@IonhourJob decorator', () => {
  let server: TestServer;
  let app: INestApplication | undefined;

  beforeEach(async () => {
    resetIonhourRegistry();
    server = await startTestServer();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    await server.close();
  });

  /** Boots the module so onModuleInit seeds the registry with a client. */
  async function bootstrapModule(): Promise<void> {
    const moduleRef = await Test.createTestingModule({
      imports: [IonhourModule.forRoot({ baseUrl: server.baseUrl })],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }

  it('pings success with duration and returns the method result when initialized', async () => {
    await bootstrapModule();

    class Worker {
      @IonhourJob('tok')
      async work(): Promise<string> {
        return 'ok';
      }
    }

    const value = await new Worker().work();

    expect(value).toBe('ok');
    // run() semantics: a start ping precedes the timed success ping.
    expect(server.requests).toHaveLength(2);
    expect(server.requests[0].path).toBe('/api/signals/ping/tok/start');
    expect(server.requests[1].path).toBe('/api/signals/ping/tok');
    expect(server.requests[1].query.get('duration')).not.toBeNull();
  });

  it('never sends an Authorization header, even for a legacy apiKey option', async () => {
    await bootstrapModule();
    // `apiKey` was removed before first publish (unenforced; see spec 027).
    // An untyped caller still passing it must not produce a Bearer header.
    const legacyOptions = { apiKey: 'ionh_legacy' } as Parameters<typeof IonhourJob>[1];

    class Worker {
      @IonhourJob('tok', legacyOptions)
      async work(): Promise<string> {
        return 'ok';
      }
    }

    await new Worker().work();

    expect(server.requests).toHaveLength(2);
    for (const request of server.requests) {
      expect(request.headers['authorization']).toBeUndefined();
    }
  });

  it('never sends an Authorization header when IONHOUR_API_KEY is set', async () => {
    // Set BEFORE the module boots: the client is built in onModuleInit, so a
    // regression that read the env var there would surface here.
    const original = process.env['IONHOUR_API_KEY'];
    process.env['IONHOUR_API_KEY'] = 'ionh_stray_env_key';
    try {
      await bootstrapModule();

      class Worker {
        @IonhourJob('tok')
        async work(): Promise<string> {
          return 'ok';
        }
      }

      await new Worker().work();

      expect(server.requests).toHaveLength(2);
      for (const request of server.requests) {
        expect(request.headers['authorization']).toBeUndefined();
      }
    } finally {
      if (original === undefined) {
        delete process.env['IONHOUR_API_KEY'];
      } else {
        process.env['IONHOUR_API_KEY'] = original;
      }
    }
  });

  it('forwards host, env and exitCode telemetry to the pings', async () => {
    await bootstrapModule();

    class Worker {
      @IonhourJob('tok', { host: 'web-1', env: 'production', exitCode: 0 })
      async work(): Promise<string> {
        return 'ok';
      }
    }

    await new Worker().work();

    expect(server.requests).toHaveLength(2);
    const [start, success] = server.requests;
    // core run(): the start ping carries rid/host/env only.
    expect(start.path).toBe('/api/signals/ping/tok/start');
    expect(start.query.get('host')).toBe('web-1');
    expect(start.query.get('env')).toBe('production');
    expect(start.query.get('exit_code')).toBeNull();
    expect(success.path).toBe('/api/signals/ping/tok');
    expect(success.query.get('host')).toBe('web-1');
    expect(success.query.get('env')).toBe('production');
    expect(success.query.get('exit_code')).toBe('0');
  });

  it('pings fail with the error and rethrows when the method throws', async () => {
    await bootstrapModule();
    const boom = new Error('cron failed');

    class Worker {
      @IonhourJob('tok')
      async work(): Promise<void> {
        throw boom;
      }
    }

    await expect(new Worker().work()).rejects.toBe(boom);
    expect(server.requests[0].path).toBe('/api/signals/ping/tok/start');
    expect(server.requests[1].path).toBe('/api/signals/ping/tok/fail');
    expect(JSON.parse(server.requests[1].body)).toEqual({ error: 'cron failed' });
  });

  it('passes call arguments through to the wrapped method', async () => {
    await bootstrapModule();

    class Worker {
      @IonhourJob('tok')
      add(a: number, b: number): number {
        return a + b;
      }
    }

    await expect(new Worker().add(2, 3)).resolves.toBe(5);
  });

  it('no-ops pings after the module is destroyed (registry reset)', async () => {
    await bootstrapModule();
    // Tear the context down; onModuleDestroy should clear the active client.
    if (app) {
      await app.close();
      app = undefined;
    }

    const warn = jest.fn();

    class Worker {
      @IonhourJob('tok', { logger: { warn } })
      async work(): Promise<string> {
        return 'still-runs';
      }
    }

    const value = await new Worker().work();

    expect(value).toBe('still-runs');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(server.requests).toHaveLength(0);
  });

  it('still runs the method, warns once, and skips pings when not initialized', async () => {
    const warn = jest.fn();

    class Worker {
      ran = 0;

      @IonhourJob('tok', { logger: { warn } })
      async work(): Promise<string> {
        this.ran += 1;
        return 'done';
      }
    }

    const worker = new Worker();
    const first = await worker.work();
    const second = await worker.work();

    expect(first).toBe('done');
    expect(second).toBe('done');
    expect(worker.ran).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(server.requests).toHaveLength(0);
  });
});
