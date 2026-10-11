# @ionhour/core

The Node SDK for [Ionhour](https://ionhour.com) heartbeat monitoring. Register
a **Job** (an inbound heartbeat monitor) and send success/fail pings from any
Node application. Zero runtime dependencies; uses the built-in global `fetch`
(Node >= 18).

Monitoring must never take down your app: ping methods **never throw** on
transport problems — they resolve to a `PingResult` and (optionally) call your
`onError` hook. Only programmer errors (empty token, oversized or
non-serializable payload) throw.

## Install

```bash
npm install @ionhour/core
```

## Quickstart

A heartbeat ping is just an HTTP GET — the entire protocol is one curl:

```bash
curl -m 10 --retry 2 https://signal.ionhour.com/api/signals/ping/your-job-token
```

The SDK is that same ping with retries, timeouts, and failure signaling handled
for you. From install to first ping in three lines — the base URL comes from
`IONHOUR_BASE_URL` when set:

```ts
import { registerJob } from '@ionhour/core';
const job = registerJob('your-job-token'); // base URL from IONHOUR_BASE_URL if set
await job.success();
```

### Slug mode

Address a job by a human-readable slug in your API key's workspace instead of
by token, and optionally create it on the first ping. The curl equivalent:

```bash
curl -H "Authorization: Bearer $IONHOUR_API_KEY" \
  "https://api.ionhour.com/api/signals/s/nightly-report?create=1"
```

```ts
import { registerJobBySlug } from '@ionhour/core';

// Reads IONHOUR_API_KEY (and IONHOUR_API_BASE_URL, default https://api.ionhour.com/api).
const job = registerJobBySlug('nightly-report', { create: true });
const result = await job.success(); // result.created is true on the ping that created it
```

A slug job has the same `success` / `fail` / `start` / `run` surface. Slug pings
go to the **API host** with `Authorization: Bearer <apiKey>`; token pings never
send the key. Slugs must match `^[a-z0-9_-]{1,64}$`. An invalid slug or a
missing `apiKey` throws `IonhourUsageError` at registration. Auto-creation
(`create: true`) needs the server flag `job_auto_provisioning`, which is OFF by
default; with it off a create ping fails with `HTTP 403 FEATURE_DISABLED`.
Server error codes such as `KEY_SCOPE_DENIED` are appended to
`PingResult.error`, and these 4xx responses are never retried.

### Wrap a function

`wrap` turns any function into a monitored one: it sends a start ping, times
each call, then pings success with the duration on completion, or pings fail
(with the error message) and rethrows on failure. Arguments and the return value
pass straight through.

```ts
import { wrap } from '@ionhour/core';

const runExport = wrap('nightly-export-token', async () => {
  await runNightlyExport();
});

await runExport(); // pinged automatically; your own error still propagates
```

Before running your function, `wrap`/`run` send a best-effort **start ping** (see
[Start ping](#start-ping-and-run-telemetry)). If you don't pass a `rid`, one is
generated and reused on the start and terminal pings so the pair correlates.
Disable it per call with `{ startPing: false }` (run-only; direct pings ignore
it).

### Explicit client

Construct a client when you want to pass config in code or share it across
jobs:

```ts
import { IonhourClient } from '@ionhour/core';

// baseUrl falls back to IONHOUR_BASE_URL.
const client = new IonhourClient({ timeout: 5000 });

// The job token is the only credential. Token pings send no Authorization header.
const job = client.registerJob('my-job-token');

await job.success();
```

`configure(config)` sets the config the package-level `registerJob` / `wrap` use
without holding a client reference yourself (and `resetDefaultClient()` clears it
in tests). Note `timeout` is in **milliseconds**:

```ts
import { configure, registerJob } from '@ionhour/core';

configure({ timeout: 5000 }); // 5000 ms = 5s per attempt
await registerJob('your-job-token').success();
```

> Call `configure()` **before** creating any wrapped function. `wrap()` binds to
> the current default client immediately, so a later `configure()` replaces the
> default client but does not rebind wrappers you already created — they keep
> pinging through the client that was active at wrap time.

### Run a block inline

`run()` is `wrap` for a single call site — it sends a start ping, times the
block, and returns its result, pinging success/fail around it:

```ts
const rows = await job.run(async () => exportRows());
```

### Fail ping

```ts
await job.fail({ payload: { reason: 'upstream 503' } });
```

### Start ping and run telemetry

`job.start()` records that a run has begun. It is **persist-only** telemetry: it
never changes monitor status, never opens or resolves an incident, and **does
not reset the schedule** — a job that starts then hangs still goes LATE. Pair it
with a terminal ping via a shared `rid` for run correlation. `run()`/`wrap()`
send it for you automatically (opt out with `{ startPing: false }`).

```ts
await job.start({ rid: 'run-42' });
// ... do the work ...
await job.success({ rid: 'run-42', durationMs: 1280 });
```

All pings accept optional telemetry (never auto-detected — pass it explicitly):

| Option     | Query param  | Notes                                                        |
|------------|--------------|--------------------------------------------------------------|
| `rid`      | `rid`        | Run correlation id.                                          |
| `durationMs` | `duration` | Execution time in **milliseconds**.                          |
| `host`     | `host`       | Hostname. Silently truncated to 253 chars.                   |
| `env`      | `env`        | Environment name. Silently truncated to 32 chars.            |
| `exitCode` | `exit_code`  | Integer 0–255; anything else throws `IonhourUsageError`.     |

```ts
await job.success({ host: 'web-1', env: 'production', exitCode: 0 });
```

## Configuration

| Option      | Default                          | Notes                                                             |
|-------------|----------------------------------|-------------------------------------------------------------------|
| `baseUrl`   | `https://signal.ionhour.com/api` | Env override: `IONHOUR_BASE_URL`.                                 |
| `timeout`   | `10000`                          | Per-attempt timeout in ms.                                        |
| `retries`   | `3`                              | Total attempts. Backoff 1s then 2s on network errors, 429, 5xx.  |
| `userAgent` | `ionhour-node/0.1.0`             | Overrides the User-Agent header.                                  |
| `onError`   | none                             | Called with the error + `{ token, fail }` (slug jobs: `{ slug, fail }`; narrow on `ctx.slug !== undefined`) on a swallowed ping. |
| `apiBaseUrl` | `https://api.ionhour.com/api`   | Slug mode only. Env override: `IONHOUR_API_BASE_URL`.             |
| `apiKey`    | none                             | Slug mode only, sent as a Bearer header. Env: `IONHOUR_API_KEY`. Trimmed; blank counts as absent. Never shown by `inspect`/`JSON.stringify`. |

Payloads are JSON, capped at 10 KiB (rejected client-side before sending).

## Base URL

The default base URL is `https://signal.ionhour.com/api`, the dedicated
heartbeat-ingest host. Set `IONHOUR_BASE_URL=https://api.ionhour.com/api` to
send pings through the main API host instead; it serves every ping route
(`/ping/:token`, `/fail`, `/start`) and is the right choice when you also use
failure or start pings and your deployment has not yet enabled them on the
signal host.

See the full docs at [docs.ionhour.com](https://docs.ionhour.com). Machine-readable
index for AI agents: <https://ionhour.com/llms.txt>.
