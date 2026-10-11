import {
  DEFAULT_API_BASE_URL,
  DEFAULT_BACKOFF_MS,
  DEFAULT_BASE_URL,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_USER_AGENT,
} from './constants';
import { IonhourUsageError } from './errors';
import type { ResolvedConfig } from './internal';
import { IonhourJob } from './job';
import type { IonhourConfig, SlugJobOptions, WrapOptions } from './types';
import { inspect } from 'node:util';
import {
  defaultNow,
  defaultRandomUUID,
  defaultSleep,
  normalizeApiKey,
  requireApiKey,
  resolveFetch,
  stripTrailingSlash,
  validateJobToken,
  validateSlug,
} from './util';

/**
 * Entry point to the SDK. Construction resolves config with the
 * `IONHOUR_BASE_URL` / `IONHOUR_API_BASE_URL` / `IONHOUR_API_KEY` env
 * fallbacks but performs no network call. Token pings authenticate by job
 * token alone and never send an `Authorization` header; only slug-mode jobs
 * send the API key, as a Bearer header to the API host.
 */
export class IonhourClient {
  private readonly config: ResolvedConfig;

  constructor(config: IonhourConfig = {}) {
    const timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new IonhourUsageError('timeout must be a positive number of milliseconds');
    }
    const retries = config.retries ?? DEFAULT_RETRIES;
    if (!Number.isInteger(retries) || retries < 1) {
      throw new IonhourUsageError('retries must be an integer >= 1');
    }
    const baseUrl = stripTrailingSlash(
      config.baseUrl ?? process.env['IONHOUR_BASE_URL'] ?? DEFAULT_BASE_URL,
    );

    const apiBaseUrl = stripTrailingSlash(
      config.apiBaseUrl ?? process.env['IONHOUR_API_BASE_URL'] ?? DEFAULT_API_BASE_URL,
    );
    const apiKey =
      normalizeApiKey(config.apiKey) ?? normalizeApiKey(process.env['IONHOUR_API_KEY']);

    this.config = {
      baseUrl,
      apiBaseUrl,
      apiKey,
      timeout,
      retries,
      userAgent: config.userAgent ?? DEFAULT_USER_AGENT,
      onError: config.onError,
      fetchImpl: resolveFetch(config.fetch),
      sleep: config.sleep ?? defaultSleep,
      now: config.now ?? defaultNow,
      backoff: config.backoff ?? DEFAULT_BACKOFF_MS,
      randomUUID: config.randomUUID ?? defaultRandomUUID,
    };
  }

  /**
   * Register a Job for pinging. Validates the token and throws immediately on
   * invalid usage. No network call.
   */
  registerJob(jobToken: string): IonhourJob {
    validateJobToken(jobToken);
    return new IonhourJob({ mode: 'token', token: jobToken }, this.config);
  }

  /**
   * Register a Job addressed by its human-readable slug (`^[a-z0-9_-]{1,64}$`)
   * in the workspace of the configured API key. Pings go to
   * `{apiBaseUrl}/signals/s/{slug}` with `Authorization: Bearer <apiKey>`;
   * `create: true` adds `?create=1` so the first ping auto-creates the job
   * (server flag `job_auto_provisioning`). Throws `IonhourUsageError` on an
   * invalid slug or a missing API key. No network call.
   */
  registerJobBySlug(slug: string, options: SlugJobOptions = {}): IonhourJob {
    validateSlug(slug);
    const apiKey = requireApiKey(this.config.apiKey);
    return new IonhourJob(
      { mode: 'slug', slug, apiKey, create: options.create === true },
      this.config,
    );
  }

  /**
   * Register `token` once and return a function that runs `fn` under `run()`
   * semantics: a timed success ping on completion, or a fail ping (with the
   * error message) plus a rethrow on failure. Arguments and the return value
   * pass straight through. The job is registered eagerly, so an invalid token
   * (or oversized/whitespace token) throws here — at wrap time — consistent
   * with {@link registerJob}.
   */
  wrap<A extends unknown[], T>(
    token: string,
    fn: (...args: A) => T | Promise<T>,
    options?: WrapOptions,
  ): (...args: A) => Promise<T> {
    const job = this.registerJob(token);
    return (...args: A) => job.run(() => fn(...args), options);
  }

  /** Curated view so logging a client shows only its public settings. */
  private redacted(): Record<string, unknown> {
    return {
      baseUrl: this.config.baseUrl,
      apiBaseUrl: this.config.apiBaseUrl,
      timeout: this.config.timeout,
      retries: this.config.retries,
      userAgent: this.config.userAgent,
    };
  }

  toJSON(): Record<string, unknown> {
    return this.redacted();
  }

  [inspect.custom](): Record<string, unknown> {
    return this.redacted();
  }
}
