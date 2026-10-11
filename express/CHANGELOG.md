# Changelog

All notable changes to `@ionhour/express` are documented here.

## 0.1.0

Initial release.

- Re-exports everything from `@ionhour/core`, including the package-level
  shortest-path helpers `registerJob` / `configure` / `wrap` (and
  `resetDefaultClient`) for plain cron work inside an Express app, plus the
  run-started `start()` ping, the `host` / `env` / `exitCode` telemetry options,
  and `wrap`/`run`'s automatic correlated start ping (`startPing` opt-out).
- `createClient(config?)` convenience factory.
- `pingMiddleware(job, opts?)` Express middleware that pings on response
  `finish` — success when `res.statusCode < failStatusThreshold` (default 500),
  fail otherwise. Options: `rid`, `includeDuration` (default `true`),
  `failStatusThreshold`. Fire-and-forget: never throws, never affects the
  response.
- Heartbeat pings authenticate by job token alone and never send an
  `Authorization` header, even when an `apiKey` is configured or
  `IONHOUR_API_KEY` is set (both are used only by slug mode). Protected jobs,
  which require an API key on pings, will ship with their own option.
- Slug mode: re-exports `registerJobBySlug` and `SlugJobOptions` from
  `@ionhour/core`; `pingMiddleware` accepts a slug job unchanged.
