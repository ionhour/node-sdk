# Changelog

All notable changes to `@ionhour/nestjs` are documented here.

## 0.1.0

Initial release.

- `IonhourModule.forRoot(options?)` and `forRootAsync({ useFactory, inject, imports })`
  global module. `forRoot()` takes no required arguments — the zero-arg,
  env-driven form (`IONHOUR_BASE_URL`) is the primary quickstart.
- `IonhourService` wrapping an `IonhourClient`: `registerJob(token)`
  plus `success` / `fail` / `run` convenience methods that take a token.
- `@IonhourJob(token, opts?)` method decorator with `run()` semantics that
  composes with `@nestjs/schedule`'s `@Cron`. Resolves the client from a
  module-scoped registry seeded in `onModuleInit`; if the module was never
  initialized the wrapped method still runs and a one-time warning is logged.
  Its options forward `rid`, `durationMs`, `payload`, `host`, `env` and
  `exitCode` to `run()`.
- Built on `@ionhour/core`. `IonhourService.run` and the `@IonhourJob` decorator
  inherit its start ping (best-effort, before the method body, with a correlated
  `rid`); `start()` is available on the core job.
- Heartbeat pings authenticate by job token alone and never send an
  `Authorization` header, even when an `apiKey` is configured or
  `IONHOUR_API_KEY` is set (both are used only by slug mode). Protected jobs,
  which require an API key on pings, will ship with their own option.
- Slug mode: `IonhourService.registerJobBySlug(slug, { create? })` and
  `@IonhourJob({ slug, create? })`, built on the core slug mode. Module options
  accept `apiBaseUrl` and `apiKey`. The decorator validates the slug at class
  definition; a slug-mode usage error at call time (no `apiKey`) never stops the
  method: it runs without pings and one warning is logged.
- The "module not initialized" warning names a slug job by its slug and a token
  job by a short token prefix only, never the full token.
