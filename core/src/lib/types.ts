/** Minimal structural view of the global `fetch`, so it can be faked in tests. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Identifies the ping a swallowed error belongs to: `{ token, fail }` for jobs
 * from `registerJob`, `{ slug, fail }` for jobs from `registerJobBySlug`.
 * Narrow on `slug !== undefined`. The slug-mode API key is never included.
 * `fail` is `true` when the failing ping was a failure ping.
 */
export type PingErrorContext =
  | { token: string; slug?: undefined; fail: boolean }
  | { slug: string; token?: undefined; fail: boolean };

export interface IonhourConfig {
  /** Base URL for the signal API. Env fallback: `IONHOUR_BASE_URL`. */
  baseUrl?: string;
  /**
   * Base URL for slug-mode pings (`registerJobBySlug`). Slug routes live on
   * the API host, not the signal host. Env fallback: `IONHOUR_API_BASE_URL`.
   * Default `https://api.ionhour.com/api`.
   */
  apiBaseUrl?: string;
  /**
   * `ionh_` API key used ONLY by slug-mode jobs, sent as
   * `Authorization: Bearer <apiKey>`. Token pings never send it. Trimmed; a
   * blank value counts as absent. Env fallback: `IONHOUR_API_KEY`.
   */
  apiKey?: string;
  /** Per-attempt timeout in milliseconds. Default 10000. */
  timeout?: number;
  /** Total attempts (initial + retries). Default 3. */
  retries?: number;
  /** Overrides the `ionhour-node/<version>` User-Agent header. */
  userAgent?: string;
  /**
   * Invoked when a ping fails at the transport layer (never for programmer
   * errors, which throw). Monitoring failures must never surface to the host
   * app, so this hook is the only signal you get for a swallowed error.
   */
  onError?: (error: Error, context: PingErrorContext) => void;

  // --- Advanced / testing hooks. Optional; leave unset in normal use. ---

  /** Inject a custom fetch implementation (defaults to the global `fetch`). */
  fetch?: FetchLike;
  /** Inject a custom sleep (defaults to `setTimeout`). Fakes backoff in tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Inject a monotonic clock (defaults to `performance.now`). */
  now?: () => number;
  /** Override the retry backoff schedule in milliseconds. Default `[1000, 2000]`. */
  backoff?: readonly number[];
  /** Inject a run-id generator (defaults to `crypto.randomUUID`). Used by `run`. */
  randomUUID?: () => string;
}

export interface PingOptions {
  /** Run correlation id, sent as the `rid` query param. */
  rid?: string;
  /** Execution time in milliseconds, sent as the `duration` query param. */
  durationMs?: number;
  /** JSON-serializable body. When present the ping is a POST; max 10 KiB. */
  payload?: unknown;
  /**
   * Hostname, sent as the `host=` query param. Silently truncated to 253 chars.
   * Never auto-detected — pass it explicitly.
   */
  host?: string;
  /**
   * Environment name (e.g. `production`), sent as `env=`. Silently truncated to
   * 32 chars. Never auto-detected — pass it explicitly.
   */
  env?: string;
  /**
   * Process exit code, sent as `exit_code=`. Must be an integer 0–255; anything
   * else throws `IonhourUsageError`. Never auto-detected.
   */
  exitCode?: number;
}

/**
 * Options for {@link IonhourJob.run} — the ping telemetry plus a run-only flag
 * to disable the automatic start ping.
 */
export type RunOptions = PingOptions & {
  /**
   * Run-only: send a best-effort start ping before `fn`. Default `true`.
   * Ignored by direct `success`/`fail`/`start` pings.
   */
  startPing?: boolean;
};

/**
 * Options for {@link IonhourClient.wrap} — the same telemetry and start-ping
 * flag as {@link RunOptions}, applied to every invocation of the wrapper.
 */
export type WrapOptions = RunOptions;

/** Options for {@link IonhourClient.registerJobBySlug}. */
export interface SlugJobOptions {
  /**
   * Auto-create the job on its first ping (`?create=1`). Needs the
   * `job_auto_provisioning` server flag and a key allowed `mcp:jobs`.
   * Default `false`.
   */
  create?: boolean;
}

export interface PingResult {
  /** `true` when the server acknowledged the ping with a 2xx. */
  ok: boolean;
  /** HTTP status code, when a response was received. */
  status?: number;
  /**
   * Error message when `ok` is `false`. Slug-mode errors append the server's
   * error `code`, e.g. `HTTP 403 KEY_SCOPE_DENIED`.
   */
  error?: string;
  /**
   * Slug mode only: `true` when this ping auto-created the job (HTTP 201 /
   * `created: true`), `false` on any other 2xx. Absent on token pings.
   */
  created?: boolean;
}
