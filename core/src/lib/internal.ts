import type { FetchLike, PingErrorContext } from './types';

/**
 * Fully-resolved configuration shared by a client and every job it registers.
 * All defaults and env fallbacks are applied by the time this exists.
 */
export interface ResolvedConfig {
  baseUrl: string;
  /** API host for slug-mode pings. */
  apiBaseUrl: string;
  /** Trimmed slug-mode key, or `undefined` when absent/blank. Never logged. */
  apiKey?: string;
  timeout: number;
  retries: number;
  userAgent: string;
  onError?: (error: Error, context: PingErrorContext) => void;
  fetchImpl: FetchLike;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  backoff: readonly number[];
  randomUUID: () => string;
}

/**
 * What a job pings. Token jobs hit the signal host with no credential; slug
 * jobs hit the API host with `Authorization: Bearer <apiKey>`.
 */
export type JobTarget =
  | { readonly mode: 'token'; readonly token: string }
  | {
      readonly mode: 'slug';
      readonly slug: string;
      readonly apiKey: string;
      readonly create: boolean;
    };
