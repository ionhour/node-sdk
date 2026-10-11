import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IonhourModule } from './ionhour.module';
import { IonhourService } from './ionhour.service';
import { resetIonhourRegistry } from './registry';
import type { IonhourModuleOptions } from './types';
import { startTestServer, type TestServer } from './__testutils__/http-server';

describe('IonhourModule + IonhourService', () => {
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

  async function bootstrap(options: IonhourModuleOptions): Promise<IonhourService> {
    const moduleRef = await Test.createTestingModule({
      imports: [IonhourModule.forRoot(options)],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    return app.get(IonhourService);
  }

  it('provides IonhourService globally', async () => {
    const service = await bootstrap({ baseUrl: server.baseUrl });
    expect(service).toBeInstanceOf(IonhourService);
  });

  it('registerJob(token).success() reaches the configured base URL', async () => {
    const service = await bootstrap({ baseUrl: server.baseUrl });
    const result = await service.registerJob('tok').success();

    expect(result.ok).toBe(true);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].path).toBe('/api/signals/ping/tok');
  });

  it('success(token, opts) convenience forwards options', async () => {
    const service = await bootstrap({ baseUrl: server.baseUrl });
    await service.success('tok', { rid: 'run-9' });
    expect(server.requests[0].query.get('rid')).toBe('run-9');
  });

  it('fail(token) sends a failure ping', async () => {
    const service = await bootstrap({ baseUrl: server.baseUrl });
    await service.fail('tok');
    expect(server.requests[0].path).toBe('/api/signals/ping/tok/fail');
  });

  it('run(token, fn) pings success with duration and returns the value', async () => {
    const service = await bootstrap({ baseUrl: server.baseUrl });
    const value = await service.run('tok', () => 'result');

    expect(value).toBe('result');
    // run() sends a start ping first; the duration lands on the terminal ping.
    expect(server.requests[0].path).toBe('/api/signals/ping/tok/start');
    expect(server.requests[1].query.get('duration')).not.toBeNull();
  });

  it('forRootAsync resolves options from a factory', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        IonhourModule.forRootAsync({
          useFactory: () => ({ baseUrl: server.baseUrl, userAgent: 'async-agent' }),
        }),
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    await app.get(IonhourService).success('tok');
    expect(server.requests[0].headers['user-agent']).toBe('async-agent');
  });
});
