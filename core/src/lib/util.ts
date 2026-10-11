import { randomUUID } from 'node:crypto';
import { MAX_ENV_LENGTH, MAX_HOST_LENGTH, SLUG_PATTERN } from './constants';
import { IonhourUsageError } from './errors';
import type { FetchLike } from './types';

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Network errors, 429, and 5xx are retryable. Other 4xx are not. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Redact a job token out of transport-error text before it reaches
 * `PingResult.error` or the `onError` hook. Some fetch implementations
 * (node-fetch, axios adapters injected via `config.fetch`) embed the full
 * request URL — which carries the token in its path — in the thrown error's
 * message. Node's built-in undici fetch does not, but we scrub unconditionally
 * for defense-in-depth and cross-SDK parity (the contract's "scrub
 * transport-error text" rule). Both the raw token and its URL-encoded form are
 * replaced with a truncated prefix of at most 8 chars and never more than half
 * the token (parity with Go/Laravel), so nothing usable survives.
 */
export function scrubToken(text: string, token: string): string {
  if (!token) {
    return text;
  }
  const marker = `${token.slice(0, Math.min(8, Math.floor(token.length / 2)))}…`;
  // split/join does a literal (non-regex) replace-all with no escaping concerns.
  let scrubbed = text.split(token).join(marker);
  const encoded = encodeURIComponent(token);
  if (encoded !== token) {
    scrubbed = scrubbed.split(encoded).join(marker);
  }
  return scrubbed;
}

export function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Registration is local — no network call — so token validation happens here
 * and throws immediately on invalid usage.
 */
export function validateJobToken(token: string): void {
  if (typeof token !== 'string' || token.length === 0) {
    throw new IonhourUsageError('jobToken must be a non-empty string');
  }
  if (/\s/.test(token)) {
    throw new IonhourUsageError('jobToken must not contain whitespace');
  }
}

/**
 * Slugs are validated locally against the server pattern so a bad slug fails
 * loudly at registration instead of as a 400 on every ping. Exported so
 * framework wrappers (e.g. the NestJS decorator) can validate eagerly. The
 * message never echoes the rejected value.
 */
export function validateSlug(slug: string): void {
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug)) {
    throw new IonhourUsageError(
      `slug must match ${SLUG_PATTERN.source} (lowercase letters, digits, "_" and "-", 1-64 chars)`,
    );
  }
}

/** Trim a key candidate; blank or non-string counts as absent. */
export function normalizeApiKey(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Slug mode needs a key. Missing or malformed keys are programmer errors and
 * fail at registration. Messages never echo the key.
 */
export function requireApiKey(apiKey: string | undefined): string {
  if (apiKey === undefined) {
    throw new IonhourUsageError(
      'slug mode needs an API key: pass apiKey or set IONHOUR_API_KEY',
    );
  }
  // Inner whitespace or control characters would corrupt the header.
  if (/[\s\x00-\x1f\x7f]/.test(apiKey)) {
    throw new IonhourUsageError('apiKey must not contain whitespace or control characters');
  }
  return apiKey;
}

export function resolveFetch(custom?: FetchLike): FetchLike {
  if (custom) {
    return custom;
  }
  const globalFetch = globalThis.fetch;
  if (typeof globalFetch !== 'function') {
    throw new IonhourUsageError(
      'global fetch is unavailable; use Node >= 18 or pass config.fetch',
    );
  }
  return (input, init) => globalFetch(input, init);
}

export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function defaultNow(): number {
  const perf = globalThis.performance;
  return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
}

export function defaultRandomUUID(): string {
  return randomUUID();
}

/**
 * Truncate `value` to `max` characters. Telemetry must never fail a heartbeat,
 * so an over-length `host`/`env` is silently trimmed rather than rejected.
 */
function truncate(value: string | undefined, max: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value.length > max ? value.slice(0, max) : value;
}

/** Silently truncate a `host` telemetry value to the wire limit (253). */
export function normalizeHost(host: string | undefined): string | undefined {
  return truncate(host, MAX_HOST_LENGTH);
}

/** Silently truncate an `env` telemetry value to the wire limit (32). */
export function normalizeEnv(env: string | undefined): string | undefined {
  return truncate(env, MAX_ENV_LENGTH);
}

/**
 * Validate an `exitCode` telemetry value. Unlike `host`/`env` (silently
 * truncated), an out-of-range exit code is a programmer error and fails loudly:
 * it must be an integer 0–255.
 */
export function validateExitCode(exitCode: number | undefined): number | undefined {
  if (exitCode === undefined) {
    return undefined;
  }
  if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
    throw new IonhourUsageError(`exitCode must be an integer between 0 and 255 (got ${exitCode})`);
  }
  return exitCode;
}
