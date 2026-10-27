# Changelog

All notable changes to `@ionhour/core` are documented here.

## 0.1.0

Initial release.

- `IonhourClient` with an env fallback for the base URL (`IONHOUR_BASE_URL`).
- `registerJob(jobToken)` with immediate token validation and no network call.
- Package-level shortest path: `registerJob(token)`, `configure(config?)`,
  and `wrap(...)` backed by a lazily-created, env-configured default client, plus
  `resetDefaultClient()` for tests. `configure` replaces the default client.
- `IonhourClient.wrap(token, fn, options?)` (and its package-level counterpart):
  registers the job once — failing fast on an invalid token at wrap time — and
  returns a function that runs `fn` under `run()` semantics (timed success ping,
  fail ping + rethrow), passing arguments and the return value through.
  `WrapOptions` has the same shape as `RunOptions`.
- `IonhourJob.success()` / `ping()` / `fail()` that never reject on transport
  problems, reporting errors via `PingResult` and the optional `onError` hook.
- `IonhourJob.run(fn, opts?)` wrapper: sends a best-effort start ping, times
  `fn`, pings success with duration on completion, pings fail (with the error
  merged into the payload) and rethrows on error. When no `rid` is supplied it
  generates one and reuses it on the start and terminal pings. Opt out of the
  start ping with `startPing: false` (run-only; `RunOptions`).
- `IonhourJob.start(opts?)`: run-started telemetry ping to
  `{base}/signals/ping/{token}/start` (GET, or POST with a payload). Persist-only
  server-side — it never resets the schedule.
- `PingOptions` telemetry: `host` (query `host=`, truncated to 253 chars),
  `env` (`env=`, truncated to 32 chars), and `exitCode` (`exit_code=`, integer
  0–255 or a loud `IonhourUsageError`). Never auto-detected.
- GET/POST wire protocol with `rid` and `duration` query params.
- Heartbeat pings authenticate by job token alone and never send an
  `Authorization` header, even when an `apiKey` is configured or
  `IONHOUR_API_KEY` is set (both are used only by slug mode). Protected jobs,
  which require an API key on pings, will ship with their own option.
- Slug mode: `IonhourClient.registerJobBySlug(slug, { create? })` and the
  package-level `registerJobBySlug`. Pings `{apiBaseUrl}/signals/s/{slug}`
  (`/fail`, `/start`) on the API host with `Authorization: Bearer <apiKey>`,
  adding `?create=1` when `create` is set. New config `apiBaseUrl`
  (`IONHOUR_API_BASE_URL`, default `https://api.ionhour.com/api`) and `apiKey`
  (`IONHOUR_API_KEY`, trimmed, blank = absent). The slug is validated against
  `^[a-z0-9_-]{1,64}$` and a missing key throws `IonhourUsageError` at
  registration. `PingResult.created` reports auto-creation (201). Slug error
  codes are appended to `PingResult.error` and never retried, except 429. The
  key never appears in `inspect`/`toJSON` output or transport-error text, and
  `onError` receives `{ slug, fail }` for slug jobs (`PingErrorContext` is a
  discriminated union of `{ token, fail }` and `{ slug, fail }`). At most 4 KiB
  of a slug response body is read; token pings never parse the body.
  `validateSlug` is exported for framework wrappers.
- Retry with backoff (3 attempts, 1s then 2s) on network errors, 429, and 5xx.
- Client-side 10 KiB payload guard.
- Transport-error text is scrubbed of the job token (raw and URL-encoded)
  before it reaches `PingResult.error` or the `onError` hook, so an injected
  `fetch` (e.g. node-fetch) that embeds the request URL in its error message
  cannot leak the token. The built-in undici fetch already omits the URL; the
  scrub adds defense-in-depth and cross-SDK parity.
