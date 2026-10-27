import { IonhourClient } from './client';
import type { PingErrorContext } from './types';
import { scrubToken } from './util';
import {
  startTestServer,
  unreachableBaseUrl,
} from './__testutils__/http-server';

// A token with URL-encodable characters ('#' -> %23) and a distinctive secret
// tail that sits beyond the 8-char prefix the scrubber is allowed to keep.
const TOKEN = 'canary#SECRET#DEADBEEF';
const ENCODED = encodeURIComponent(TOKEN); // canary%23SECRET%23DEADBEEF
const SECRET_TAIL = 'DEADBEEF';

/** Fails if the raw token, its URL-encoded form, or its secret tail appears. */
function assertNoTokenLeak(...texts: Array<string | undefined>): void {
  const blob = texts.filter((t): t is string => typeof t === 'string').join(' || ');
  expect(blob).not.toContain(TOKEN);
  expect(blob).not.toContain(ENCODED);
  expect(blob).not.toContain(SECRET_TAIL);
}

describe('scrubToken', () => {
  it('replaces the raw token with a <=8-char prefix marker', () => {
    const out = scrubToken(`boom involving ${TOKEN} here`, TOKEN);
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(SECRET_TAIL);
    expect(out).toContain('canary#S'); // the kept prefix, nothing past it
  });

  it('replaces the URL-encoded token form too', () => {
    const out = scrubToken(`request to http://x/api/signals/ping/${ENCODED} failed`, TOKEN);
    expect(out).not.toContain(ENCODED);
    expect(out).not.toContain(SECRET_TAIL);
  });

  it('keeps at most half of a short token (contract: <=8 chars and <=half)', () => {
    // A 6-char token keeps a 3-char prefix, never 6 (which would be the token).
    expect(scrubToken('error for abcdef here', 'abcdef')).toBe('error for abc… here');
  });

  it('is a no-op when the token is absent from the text', () => {
    expect(scrubToken('fetch failed', TOKEN)).toBe('fetch failed');
  });
});

describe('transport-error token redaction', () => {
  it('never leaks the token on a real transport failure (default fetch)', async () => {
    const baseUrl = await unreachableBaseUrl();
    const captured: Array<{ error: Error; ctx: PingErrorContext }> = [];
    const client = new IonhourClient({
      baseUrl,
      retries: 1,
      sleep: async () => undefined,
      onError: (error, ctx) => captured.push({ error, ctx }),
    });

    const result = await client.registerJob(TOKEN).success();

    expect(result.ok).toBe(false);
    assertNoTokenLeak(result.error);
    expect(captured).toHaveLength(1);
    assertNoTokenLeak(captured[0].error.message, captured[0].error.stack);
    // The onError CONTEXT intentionally carries the token for attribution.
    expect(captured[0].ctx.token).toBe(TOKEN);
  });

  it('never leaks the token on retry exhaustion against an HTTP 500', async () => {
    const server = await startTestServer(() => ({ status: 500 }));
    const errors: Error[] = [];
    try {
      const client = new IonhourClient({
        baseUrl: server.baseUrl,
        retries: 2,
        sleep: async () => undefined,
        onError: (error) => errors.push(error),
      });

      const result = await client.registerJob(TOKEN).success();

      expect(result).toEqual({ ok: false, status: 500, error: 'HTTP 500' });
      assertNoTokenLeak(result.error);
      expect(errors).toHaveLength(1);
      assertNoTokenLeak(errors[0].message, errors[0].stack);
    } finally {
      await server.close();
    }
  });

  it('scrubs a URL-embedding custom fetch (node-fetch / axios style)', async () => {
    const errors: Error[] = [];
    let thrownMessage = '';
    const client = new IonhourClient({
      baseUrl: 'http://signal.example/api',
      retries: 1,
      sleep: async () => undefined,
      // Mimics node-fetch: the full request URL (carrying the encoded token) is
      // embedded in the thrown message — the realistic leak vector we close.
      fetch: (input) => {
        thrownMessage = `request to ${input} failed, reason: getaddrinfo ENOTFOUND`;
        throw new Error(thrownMessage);
      },
      onError: (error) => errors.push(error),
    });

    const result = await client.registerJob(TOKEN).success();

    // Prove the pre-scrub message truly carried the token, so a clean result
    // reflects the scrub doing work — not merely a token-free error.
    expect(thrownMessage).toContain(ENCODED);
    expect(result.ok).toBe(false);
    assertNoTokenLeak(result.error);
    expect(errors).toHaveLength(1);
    assertNoTokenLeak(errors[0].message, errors[0].stack);
  });

  it('never leaks the token through run() ping-transport failures', async () => {
    const baseUrl = await unreachableBaseUrl();
    const errors: Error[] = [];
    const client = new IonhourClient({
      baseUrl,
      retries: 1,
      sleep: async () => undefined,
      onError: (error) => errors.push(error),
    });

    // fn succeeds; the start AND success pings fail at transport, both swallowed
    // to onError. Neither may carry the token.
    await client.registerJob(TOKEN).run(() => 'ok');

    expect(errors).toHaveLength(2);
    for (const error of errors) {
      assertNoTokenLeak(error.message, error.stack);
    }
  });
});
