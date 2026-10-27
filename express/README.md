# @ionhour/express

[Ionhour](https://ionhour.com) heartbeat monitoring for Express. Re-exports all
of [`@ionhour/core`](https://www.npmjs.com/package/@ionhour/core) — including the
package-level `registerJob` / `configure` / `wrap` — and adds a `createClient`
helper plus a fire-and-forget `pingMiddleware`.

Monitoring never takes down your app: pings never throw and the middleware can
never affect the response.

## Install

```bash
npm install @ionhour/express
```

## Quickstart

A heartbeat ping is just an HTTP GET — the entire protocol is one curl:

```bash
curl -m 10 --retry 2 https://signal.ionhour.com/api/signals/ping/your-endpoint-token
```

The SDK is that same ping with retries, timeouts, and failure signaling handled
for you. Mount `pingMiddleware` on a route to ping automatically when the
response finishes — `baseUrl` comes from `IONHOUR_BASE_URL` when set:

```ts
import express from 'express';
import { createClient, pingMiddleware } from '@ionhour/express';

const app = express();

// The job token is the only credential; token pings send no Authorization header.
const job = createClient().registerJob('my-endpoint-token');

app.use('/health', pingMiddleware(job), (req, res) => {
  res.json({ ok: true });
});
```

### Slug mode

`pingMiddleware` also accepts a slug job, addressed by slug in your API key's
workspace. `apiKey` comes from config or `IONHOUR_API_KEY`:

```ts
const checkout = createClient({ apiKey: process.env.IONHOUR_API_KEY })
  .registerJobBySlug('checkout-health', { create: true });

app.use('/checkout/health', pingMiddleware(checkout), handler);
```

Slug pings go to the API host (`apiBaseUrl`, default
`https://api.ionhour.com/api`) with `Authorization: Bearer <apiKey>`; token
pings never send the key. `create: true` needs the server flag
`job_auto_provisioning` (OFF by default). The package-level
`registerJobBySlug` is re-exported from `@ionhour/core`.

### Plain cron work inside an Express app

For scheduled work that isn't tied to a request, reach for the core
package-level path directly — no client to construct. `wrap` (re-exported from
`@ionhour/core`) times each call and pings success/fail around it:

```ts
import { wrap } from '@ionhour/express';

const runNightly = wrap('nightly-export-token', async () => {
  await runNightlyExport();
});

await runNightly(); // pinged automatically; your own error still propagates
```

`wrap`/`run` send a best-effort start ping before your function and correlate it
to the terminal ping via a generated `rid` (opt out with `{ startPing: false }`).
The run-started `job.start()` ping and the `host` / `env` / `exitCode` telemetry
options come through from [`@ionhour/core`](https://www.npmjs.com/package/@ionhour/core).

### Fail ping

```ts
await job.fail({ payload: { reason: 'upstream 503' } });
```

## Middleware options

| Option                | Default | Notes                                                        |
|-----------------------|---------|--------------------------------------------------------------|
| `failStatusThreshold` | `500`   | A response status at or above this sends a fail ping.        |
| `includeDuration`     | `true`  | Send the wall-clock request duration as the `duration` param.|
| `rid`                 | none    | `(req) => string` — sent as the `rid` query param.           |

## Client configuration

Accepts the full [`@ionhour/core`](https://www.npmjs.com/package/@ionhour/core)
config.

| Option      | Default                          | Notes                                                       |
|-------------|----------------------------------|-------------------------------------------------------------|
| `baseUrl`   | `https://signal.ionhour.com/api` | Env override: `IONHOUR_BASE_URL`.                           |
| `timeout`   | `10000`                          | Per-attempt timeout in ms.                                  |
| `retries`   | `3`                              | Backoff 1s then 2s on network errors, 429, 5xx.            |
| `apiBaseUrl` | `https://api.ionhour.com/api`   | Slug mode only. Env override: `IONHOUR_API_BASE_URL`.       |
| `apiKey`    | none                             | Slug mode only, sent as a Bearer header. Env: `IONHOUR_API_KEY`. |

## Base URL

The default base URL is `https://signal.ionhour.com/api`, the dedicated
heartbeat-ingest host. Set `IONHOUR_BASE_URL=https://api.ionhour.com/api` to
send pings through the main API host instead; it serves every ping route
(`/ping/:token`, `/fail`, `/start`) and is the right choice when you also use
failure or start pings and your deployment has not yet enabled them on the
signal host.

See the full docs at [docs.ionhour.com](https://docs.ionhour.com). Machine-readable
index for AI agents: <https://ionhour.com/llms.txt>.
