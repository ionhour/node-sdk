import { inspect } from 'node:util';
import { MAX_PAYLOAD_BYTES } from './constants';
import { IonhourUsageError } from './errors';
import type { JobTarget, ResolvedConfig } from './internal';
import { sendPing, type PingKind } from './transport';
import type { PingOptions, PingResult, RunOptions } from './types';
import { errorMessage, normalizeEnv, normalizeHost, validateExitCode } from './util';

/**
 * Serializes a payload client-side and rejects invalid usage loudly:
 * non-serializable values and bodies over 10 KiB throw `IonhourUsageError`.
 * Returns `undefined` for an absent payload (=> GET ping).
 */
function serializePayload(payload: unknown): string | undefined {
  if (payload === undefined) {
    return undefined;
  }
  let body: string | undefined;
  try {
    body = JSON.stringify(payload);
  } catch (error) {
    throw new IonhourUsageError(`payload is not JSON-serializable: ${errorMessage(error)}`);
  }
  if (body === undefined) {
    throw new IonhourUsageError('payload is not JSON-serializable');
  }
  const bytes = new TextEncoder().encode(body).length;
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw new IonhourUsageError(`payload exceeds ${MAX_PAYLOAD_BYTES} bytes (got ${bytes})`);
  }
  return body;
}

/** Merges the failure message into any user-supplied object payload. */
function mergeErrorPayload(payload: unknown, message: string): Record<string, unknown> {
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    return { ...(payload as Record<string, unknown>), error: message };
  }
  if (payload === undefined) {
    return { error: message };
  }
  return { error: message, payload };
}

/**
 * A registered inbound heartbeat monitor. Obtain one via
 * `client.registerJob(token)` (token ping, no credential) or
 * `client.registerJobBySlug(slug)` (slug ping on the API host with the Bearer
 * key). Ping methods never throw on transport problems — they resolve to a
 * `PingResult` and route the error to `onError`.
 */
export class IonhourJob {
  /** @internal Construct via `IonhourClient.registerJob` / `registerJobBySlug`. */
  constructor(
    private readonly target: JobTarget,
    private readonly config: ResolvedConfig,
  ) {}

  /** Send a success ping. Never rejects on transport failure. */
  success(options?: PingOptions): Promise<PingResult> {
    return this.dispatch('success', options);
  }

  /** Alias for {@link success}. */
  ping(options?: PingOptions): Promise<PingResult> {
    return this.success(options);
  }

  /** Send a failure ping. Never rejects on transport failure. */
  fail(options?: PingOptions): Promise<PingResult> {
    return this.dispatch('fail', options);
  }

  /**
   * Send a run-started telemetry ping. Persist-only server-side: it records the
   * start but never changes monitor status, never opens/resolves incidents, and
   * **never resets the schedule** — a job that starts then hangs still goes
   * LATE. Pair it with a terminal ping via a shared `rid` for run correlation.
   * Never rejects on transport failure.
   */
  start(options?: PingOptions): Promise<PingResult> {
    return this.dispatch('start', options);
  }

  /**
   * Send a best-effort start ping (unless disabled), then time `fn` and ping
   * success (with duration) on completion, or ping fail (with the error message
   * merged into `payload`) on error. When the caller supplies no `rid`, one is
   * generated and reused on the start and terminal pings so the pair
   * correlates. Every internal ping error is swallowed; `fn`'s own error is
   * always rethrown so the caller sees it.
   */
  async run<T>(fn: () => T | Promise<T>, options?: RunOptions): Promise<T> {
    const { startPing = true, ...pingOptions } = options ?? {};
    const rid = pingOptions.rid ?? (startPing ? this.config.randomUUID() : undefined);

    if (startPing) {
      // Best-effort: rid/host/env only — no duration/exitCode/payload.
      await this.safeDispatch('start', {
        rid,
        host: pingOptions.host,
        env: pingOptions.env,
      });
    }

    const start = this.config.now();
    let result: T;
    try {
      result = await fn();
    } catch (error) {
      const durationMs = this.elapsed(start);
      await this.safeDispatch('fail', {
        rid,
        durationMs,
        host: pingOptions.host,
        env: pingOptions.env,
        exitCode: pingOptions.exitCode,
        payload: mergeErrorPayload(pingOptions.payload, errorMessage(error)),
      });
      throw error;
    }
    await this.safeDispatch('success', { ...pingOptions, rid, durationMs: this.elapsed(start) });
    return result;
  }

  private elapsed(start: number): number {
    return Math.max(0, Math.round(this.config.now() - start));
  }

  private async dispatch(kind: PingKind, options?: PingOptions): Promise<PingResult> {
    const body = serializePayload(options?.payload);
    // Telemetry normalization: host/env truncate silently, exitCode fails loud.
    const result = await sendPing(this.config, {
      target: this.target,
      kind,
      rid: options?.rid,
      durationMs: options?.durationMs,
      host: normalizeHost(options?.host),
      env: normalizeEnv(options?.env),
      exitCode: validateExitCode(options?.exitCode),
      body,
    });
    if (!result.ok) {
      this.reportError(new Error(result.error ?? 'ping failed'), kind);
    }
    return result;
  }

  /** Like {@link dispatch} but also swallows usage errors — used by `run`. */
  private async safeDispatch(kind: PingKind, options?: PingOptions): Promise<PingResult> {
    try {
      return await this.dispatch(kind, options);
    } catch (error) {
      const asError = error instanceof Error ? error : new Error(errorMessage(error));
      this.reportError(asError, kind);
      return { ok: false, error: errorMessage(error) };
    }
  }

  private reportError(error: Error, kind: PingKind): void {
    const fail = kind === 'fail';
    const context =
      this.target.mode === 'slug'
        ? { slug: this.target.slug, fail }
        : { token: this.target.token, fail };
    this.config.onError?.(error, context);
  }

  /** Redacted view so logging a job never leaks the token or API key. */
  private redacted(): Record<string, unknown> {
    if (this.target.mode === 'slug') {
      return {
        slug: this.target.slug,
        create: this.target.create,
        apiBaseUrl: this.config.apiBaseUrl,
      };
    }
    return {
      token: '<redacted>',
      baseUrl: this.config.baseUrl,
    };
  }

  toJSON(): Record<string, unknown> {
    return this.redacted();
  }

  [inspect.custom](): Record<string, unknown> {
    return this.redacted();
  }
}
