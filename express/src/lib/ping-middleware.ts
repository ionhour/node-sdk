import type { IonhourJob, PingOptions } from '@ionhour/core';
import type { NextFunction, Request, Response } from 'express';

export interface PingMiddlewareOptions {
  /** Derive a run id from the request; sent as the `rid` query param. */
  rid?: (req: Request) => string | undefined;
  /** Send the wall-clock request duration as the `duration` param. Default `true`. */
  includeDuration?: boolean;
  /** A response status at or above this sends a fail ping. Default `500`. */
  failStatusThreshold?: number;
}

export type PingMiddleware = (req: Request, res: Response, next: NextFunction) => void;

/** Monotonic clock, mirroring core's `defaultNow` discipline (not wall-clock). */
function monotonicNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * Express middleware that pings `job` once the response finishes: a success
 * ping when `res.statusCode < failStatusThreshold`, a fail ping otherwise.
 *
 * Fire-and-forget: it never throws, never awaits the ping on the request path,
 * and can never affect the response.
 */
export function pingMiddleware(
  job: IonhourJob,
  options: PingMiddlewareOptions = {},
): PingMiddleware {
  const includeDuration = options.includeDuration ?? true;
  const failStatusThreshold = options.failStatusThreshold ?? 500;

  return function ionhourPingMiddleware(req: Request, res: Response, next: NextFunction): void {
    const startedAt = monotonicNow();
    let pinged = false;

    res.on('finish', () => {
      if (pinged) {
        return;
      }
      pinged = true;

      const pingOptions: PingOptions = {};
      if (includeDuration) {
        pingOptions.durationMs = Math.round(monotonicNow() - startedAt);
      }

      let rid: string | undefined;
      try {
        rid = options.rid?.(req);
      } catch {
        rid = undefined;
      }
      if (rid !== undefined) {
        pingOptions.rid = rid;
      }

      const failing = res.statusCode >= failStatusThreshold;
      const ping = failing ? job.fail(pingOptions) : job.success(pingOptions);
      // Ping methods already never reject; this guard is belt-and-braces so a
      // monitoring failure can never surface on the request path.
      Promise.resolve(ping).catch(() => undefined);
    });

    next();
  };
}
