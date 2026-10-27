# @ionhour/nestjs

[Ionhour](https://ionhour.com) heartbeat monitoring for NestJS. Provides an
injectable `IonhourService` and an `@IonhourJob` method decorator that composes
with `@nestjs/schedule`'s `@Cron`. Built on
[`@ionhour/core`](https://www.npmjs.com/package/@ionhour/core).

Monitoring never takes down your app: ping methods never throw on transport
problems. Only programmer errors (empty token, oversized payload) throw.

## Install

```bash
npm install @ionhour/nestjs
```

## Quickstart

A heartbeat ping is just an HTTP GET — the entire protocol is one curl:

```bash
curl -m 10 --retry 2 https://signal.ionhour.com/api/signals/ping/your-job-token
```

The SDK is that same ping with retries, timeouts, and failure signaling handled
for you. Register the module with **no arguments** — `baseUrl` comes from
`IONHOUR_BASE_URL` when set — then decorate a scheduled method:

```ts
import { IonhourModule, IonhourJob } from '@ionhour/nestjs';

@Module({
  imports: [IonhourModule.forRoot()], // base URL from IONHOUR_BASE_URL if set
})
export class AppModule {}

@Injectable()
export class ExportCron {
  @Cron('0 2 * * *')
  @IonhourJob('nightly-export-token')
  async run() {
    await this.export(); // timed; success/fail pinged automatically; errors rethrow
  }
}
```

> **Decorated methods are always invoked asynchronously.** `@IonhourJob`
> replaces the method with an `async` wrapper that returns `Promise<T>`. Declare
> decorated methods `async` (or returning `Promise<T>`) and `await` their
> result — a previously synchronous return value becomes a promise.

If `IonhourModule` was never initialized (or has been destroyed) the decorated
method still runs and a one-time warning is logged (pings are disabled).

### Slug mode

Address a job by slug in your API key's workspace instead of by token. Pass
`{ slug, create? }` to the decorator, or call `registerJobBySlug` on the
service. `apiKey` comes from module options or `IONHOUR_API_KEY`:

```ts
@Module({
  imports: [IonhourModule.forRoot({ apiKey: process.env.IONHOUR_API_KEY })],
})
export class AppModule {}

@Injectable()
export class ReportCron {
  @Cron('0 3 * * *')
  @IonhourJob({ slug: 'nightly-report', create: true })
  async run() {
    await this.report();
  }
}
```

Slug pings go to the API host (`apiBaseUrl`, default
`https://api.ionhour.com/api`) with `Authorization: Bearer <apiKey>`; token
pings never send the key. `create: true` auto-creates the job on its first
ping and needs the server flag `job_auto_provisioning` (OFF by default). An
invalid slug throws `IonhourUsageError` when the class is defined. If slug mode
is unusable when the method runs (for example no `apiKey`), the method still
runs, pings are skipped, and one `pings disabled` warning is logged. The
service's `registerJobBySlug` throws `IonhourUsageError` in that case.

Because `@IonhourJob` and `IonhourService.run` use `run()` semantics, each
invocation also sends a best-effort **start ping** before the method body, with
a generated `rid` correlating the start and terminal pings. The start ping is
persist-only and never resets the schedule.

The decorator forwards the ping telemetry options (`rid`, `durationMs`,
`payload`, `host`, `env`, `exitCode`) to every ping it sends:

```ts
@IonhourJob('token', { env: 'production' })
async run() {
  await this.export();
}
```

`job.start()` is available on the underlying
[`@ionhour/core`](https://www.npmjs.com/package/@ionhour/core) job returned by
`registerJob`.

## Explicit configuration

Pass config in code when you don't want to rely on env, or resolve it
asynchronously from `ConfigService`. Note `timeout` is in **milliseconds**:

```ts
IonhourModule.forRoot({ baseUrl: process.env.IONHOUR_BASE_URL, timeout: 5000 });
```

```ts
IonhourModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({ baseUrl: config.get('IONHOUR_BASE_URL') }),
});
```

## Use the service

```ts
@Injectable()
export class BillingJobs {
  constructor(private readonly ionhour: IonhourService) {}

  async nightly() {
    // The job token is the only credential; token pings send no Authorization header.
    const job = this.ionhour.registerJob('nightly-close-token');
    await job.run(async () => {
      await this.closeBooks();
    });
  }
}
```

Convenience helpers take a token directly:

```ts
await this.ionhour.success('token');
await this.ionhour.fail('token', { payload: { reason: 'upstream 503' } });
await this.ionhour.run('token', () => this.doWork());

// Slug mode (needs apiKey):
await this.ionhour.registerJobBySlug('nightly-report', { create: true }).success();
```

## Configuration

Accepts the full [`@ionhour/core`](https://www.npmjs.com/package/@ionhour/core)
config (`baseUrl`, `timeout`, `retries`, `userAgent`, `onError`, and the
slug-mode `apiBaseUrl` / `apiKey`).

| Option      | Default                          | Notes                                                            |
|-------------|----------------------------------|------------------------------------------------------------------|
| `baseUrl`   | `https://signal.ionhour.com/api` | Env override: `IONHOUR_BASE_URL`.                                |
| `timeout`   | `10000`                          | Per-attempt timeout in ms.                                       |
| `retries`   | `3`                              | Backoff 1s then 2s on network errors, 429, 5xx.                 |
| `onError`   | none                             | Called on a swallowed ping with `{ token, fail }`.               |

## Base URL

The default base URL is `https://signal.ionhour.com/api`, the dedicated
heartbeat-ingest host. Set `IONHOUR_BASE_URL=https://api.ionhour.com/api` to
send pings through the main API host instead; it serves every ping route
(`/ping/:token`, `/fail`, `/start`) and is the right choice when you also use
failure or start pings and your deployment has not yet enabled them on the
signal host.

See the full docs at [docs.ionhour.com](https://docs.ionhour.com). Machine-readable
index for AI agents: <https://ionhour.com/llms.txt>.
