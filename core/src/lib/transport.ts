import { ERROR_CODE_PATTERN, MAX_RESPONSE_BODY_BYTES } from './constants';
import type { JobTarget, ResolvedConfig } from './internal';
import type { PingResult } from './types';
import { errorMessage, isRetryableStatus, scrubToken } from './util';

/** Which endpoint a ping targets: the base path, `/fail`, or `/start`. */
export type PingKind = 'success' | 'fail' | 'start';

const PATH_SUFFIX: Record<PingKind, string> = {
  success: '',
  fail: '/fail',
  start: '/start',
};

export interface PingRequest {
  target: JobTarget;
  kind: PingKind;
  rid?: string;
  durationMs?: number;
  host?: string;
  env?: string;
  exitCode?: number;
  /** Pre-serialized JSON body. Absent => GET, present => POST. */
  body?: string;
}

function buildPath(config: ResolvedConfig, req: PingRequest): string {
  const suffix = PATH_SUFFIX[req.kind];
  const { target } = req;
  if (target.mode === 'slug') {
    return `${config.apiBaseUrl}/signals/s/${encodeURIComponent(target.slug)}${suffix}`;
  }
  return `${config.baseUrl}/signals/ping/${encodeURIComponent(target.token)}${suffix}`;
}

function buildUrl(config: ResolvedConfig, req: PingRequest): string {
  const path = buildPath(config, req);
  const params = new URLSearchParams();
  if (req.target.mode === 'slug' && req.target.create) {
    params.set('create', '1');
  }
  if (req.rid !== undefined) {
    params.set('rid', req.rid);
  }
  if (req.durationMs !== undefined) {
    params.set('duration', String(req.durationMs));
  }
  if (req.host !== undefined) {
    params.set('host', req.host);
  }
  if (req.env !== undefined) {
    params.set('env', req.env);
  }
  if (req.exitCode !== undefined) {
    params.set('exit_code', String(req.exitCode));
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** Token pings never carry a credential; only slug pings send the Bearer key. */
function buildHeaders(config: ResolvedConfig, req: PingRequest): Record<string, string> {
  const headers: Record<string, string> = { 'user-agent': config.userAgent };
  if (req.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (req.target.mode === 'slug') {
    headers['authorization'] = `Bearer ${req.target.apiKey}`;
  }
  return headers;
}

/** The secret to redact from transport-error text for this target. */
function secretOf(target: JobTarget): string {
  return target.mode === 'slug' ? target.apiKey : target.token;
}

function backoffFor(config: ResolvedConfig, attempt: number): number {
  if (config.backoff.length === 0) {
    return 0;
  }
  const index = Math.min(attempt - 1, config.backoff.length - 1);
  return config.backoff[index];
}

/**
 * Read at most `MAX_RESPONSE_BODY_BYTES` of the body, then cancel the stream,
 * so a huge or endless response can never exhaust memory.
 */
async function readCappedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return '';
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_RESPONSE_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) {
        break;
      }
      const room = MAX_RESPONSE_BODY_BYTES - total;
      const kept = value.byteLength > room ? value.subarray(0, room) : value;
      chunks.push(kept);
      total += kept.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(total);
  chunks.reduce((offset, chunk) => {
    bytes.set(chunk, offset);
    return offset + chunk.byteLength;
  }, 0);
  return new TextDecoder().decode(bytes);
}

/** Best-effort JSON body read, capped at 4 KiB; never throws. */
async function readJson(response: Response): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readCappedText(response));
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

async function successResult(req: PingRequest, response: Response): Promise<PingResult> {
  if (req.target.mode !== 'slug') {
    return { ok: true, status: response.status };
  }
  const created = response.status === 201 || (await readJson(response))?.['created'] === true;
  return { ok: true, status: response.status, created };
}

/**
 * Slug routes answer with `{ statusCode, error, code, message }`. Only a
 * well-formed `code` is surfaced; the free-text message is dropped.
 */
async function failureResult(req: PingRequest, response: Response): Promise<PingResult> {
  const status = response.status;
  const code = req.target.mode === 'slug' ? (await readJson(response))?.['code'] : undefined;
  const suffix = typeof code === 'string' && ERROR_CODE_PATTERN.test(code) ? ` ${code}` : '';
  return { ok: false, status, error: `HTTP ${status}${suffix}` };
}

/**
 * Sends a single ping with retries. Never throws: transport failures are
 * returned as `{ ok: false }`. Retries on network error, 429, and 5xx only.
 */
export async function sendPing(config: ResolvedConfig, req: PingRequest): Promise<PingResult> {
  const url = buildUrl(config, req);
  const headers = buildHeaders(config, req);
  const method = req.body !== undefined ? 'POST' : 'GET';
  const attempts = Math.max(1, config.retries);

  let lastError = 'request failed';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeout);
    try {
      const response = await config.fetchImpl(url, {
        method,
        headers,
        body: req.body,
        signal: controller.signal,
      });
      if (response.ok) {
        return await successResult(req, response);
      }
      if (isRetryableStatus(response.status) && attempt < attempts) {
        clearTimeout(timer);
        await config.sleep(backoffFor(config, attempt));
        continue;
      }
      return await failureResult(req, response);
    } catch (error) {
      clearTimeout(timer);
      // Scrub the credential (job token or API key) from the transport-error
      // text: an injected fetch may embed the URL or headers in its message.
      lastError = scrubToken(errorMessage(error), secretOf(req.target));
      if (attempt < attempts) {
        await config.sleep(backoffFor(config, attempt));
        continue;
      }
      return { ok: false, error: lastError };
    } finally {
      clearTimeout(timer);
    }
  }
  // Unreachable: the loop always returns. Present for exhaustiveness.
  return { ok: false, error: lastError };
}
