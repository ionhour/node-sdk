/**
 * Contract defaults. Source of truth for these values is
 * `sdks/CONTRACT.md` (client configuration + wire protocol tables).
 */
export const SDK_VERSION = '0.1.0';

export const DEFAULT_BASE_URL = 'https://signal.ionhour.com/api';

/**
 * API host for slug-mode pings (`/signals/s/{slug}`). The signal host serves
 * only token pings, so slug mode has its own base URL.
 */
export const DEFAULT_API_BASE_URL = 'https://api.ionhour.com/api';

/** Slugs the server accepts on `/signals/s/{slug}`. */
export const SLUG_PATTERN = /^[a-z0-9_-]{1,64}$/;

/** Max bytes of a slug-route response body the SDK reads and parses. */
export const MAX_RESPONSE_BODY_BYTES = 4 * 1024;

/** Shape of a server error `code` worth surfacing in `PingResult.error`. */
export const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

/** Per-attempt request timeout. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Total attempts (initial try + retries). */
export const DEFAULT_RETRIES = 3;

/** Backoff before each subsequent attempt: 1s, then 2s. */
export const DEFAULT_BACKOFF_MS: readonly number[] = [1_000, 2_000];

/** Server rejects POST bodies larger than 10 KiB; refuse client-side first. */
export const MAX_PAYLOAD_BYTES = 10_240;

/** Wire limit for the `host=` telemetry param; longer values are truncated. */
export const MAX_HOST_LENGTH = 253;

/** Wire limit for the `env=` telemetry param; longer values are truncated. */
export const MAX_ENV_LENGTH = 32;

export const DEFAULT_USER_AGENT = `ionhour-node/${SDK_VERSION}`;
