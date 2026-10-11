import { IonhourClient } from './client';
import type { IonhourJob } from './job';
import type { IonhourConfig, SlugJobOptions, WrapOptions } from './types';

/**
 * Package-level default client for the shortest path: import `registerJob` /
 * `wrap` and go, with the base URL from the `IONHOUR_BASE_URL` env. The
 * client is created lazily on first use (or eagerly via {@link configure}) and
 * reused across calls.
 */
let defaultClient: IonhourClient | undefined;

/**
 * Create a new default client from `config` (env fallbacks apply as usual),
 * replacing any existing one, and return it. Use this to hand explicit config
 * to the package-level {@link registerJob} / {@link wrap} without holding a
 * client reference yourself.
 */
export function configure(config?: IonhourConfig): IonhourClient {
  defaultClient = new IonhourClient(config);
  return defaultClient;
}

/** Lazily materialize the default client from env if `configure` was never called. */
function getDefaultClient(): IonhourClient {
  if (!defaultClient) {
    defaultClient = new IonhourClient();
  }
  return defaultClient;
}

/**
 * Register a Job on the default client (created lazily from env on first use).
 * Equivalent to `configure().registerJob(...)` but with zero setup.
 */
export function registerJob(token: string): IonhourJob {
  return getDefaultClient().registerJob(token);
}

/**
 * {@link IonhourClient.registerJobBySlug} on the default client: slug mode
 * with the API key from `configure({ apiKey })` or `IONHOUR_API_KEY`.
 */
export function registerJobBySlug(slug: string, options?: SlugJobOptions): IonhourJob {
  return getDefaultClient().registerJobBySlug(slug, options);
}

/**
 * {@link IonhourClient.wrap} on the default client — the package-level
 * one-liner. Registers `token` once and returns a `run()`-semantics wrapper of
 * `fn`.
 *
 * IMPORTANT: `wrap` binds to the current default client immediately (it
 * materializes the client and registers the job synchronously). Call
 * {@link configure} BEFORE creating any wrapped function — a later `configure`
 * replaces the default client but does NOT rebind wrappers already created, so
 * they keep pinging through the client that was active at wrap time. This
 * matches `registerJob`'s snapshot semantics and the fail-fast-at-wrap-time
 * contract.
 */
export function wrap<A extends unknown[], T>(
  token: string,
  fn: (...args: A) => T | Promise<T>,
  options?: WrapOptions,
): (...args: A) => Promise<T> {
  return getDefaultClient().wrap(token, fn, options);
}

/** Test helper: drop the default client so the next call recreates it. */
export function resetDefaultClient(): void {
  defaultClient = undefined;
}
