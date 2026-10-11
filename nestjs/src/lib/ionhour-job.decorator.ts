import { IonhourUsageError, validateSlug } from '@ionhour/core';
import type { IonhourClient, IonhourJob as CoreJob, PingOptions } from '@ionhour/core';
import { defaultLogger } from './logger';
import { getActiveIonhourClient, warnModuleNotInitializedOnce } from './registry';
import type { IonhourJobOptions, IonhourSlugJobTarget } from './types';

type AnyMethod = (this: unknown, ...args: unknown[]) => unknown;

/** A job token, or a slug-mode target. */
type JobRef = string | IonhourSlugJobTarget;

/** Max chars of a token shown in a log line: <= 8 and <= half the token. */
function redactToken(token: string): string {
  return `${token.slice(0, Math.min(8, Math.floor(token.length / 2)))}…`;
}

/** Log label for a job: the slug in full (not a secret), a token prefix only. */
function describeJob(job: JobRef): string {
  return typeof job === 'string' ? `"${redactToken(job)}"` : `{ slug: "${job.slug}" }`;
}

function registerOn(client: IonhourClient, job: JobRef): CoreJob {
  return typeof job === 'string'
    ? client.registerJob(job)
    : client.registerJobBySlug(job.slug, { create: job.create });
}

/**
 * Register a slug job, or return `undefined` when the module config makes slug
 * mode unusable (e.g. no `apiKey`). Monitoring must never stop the decorated
 * method from running, so that case is a one-time warning. Core usage-error
 * messages never contain the API key.
 */
function tryRegisterSlug(
  client: IonhourClient,
  target: IonhourSlugJobTarget,
  warnOnce: (message: string) => void,
): CoreJob | undefined {
  try {
    return registerOn(client, target);
  } catch (error) {
    if (!(error instanceof IonhourUsageError)) {
      throw error;
    }
    warnOnce(
      `[ionhour] @IonhourJob(${describeJob(target)}) pings disabled: ${error.message}`,
    );
    return undefined;
  }
}

/**
 * Method decorator that wraps the method with `IonhourJob.run()` semantics —
 * a success ping (with duration) on completion, a fail ping (with the error)
 * on throw, and the original error rethrown. Composes with `@nestjs/schedule`'s
 * `@Cron`.
 *
 * Pass a job token, or `{ slug, create? }` for slug mode (the module's
 * `apiKey` is sent as a Bearer header to the API host). A slug is validated
 * when the class is defined, so an invalid one throws `IonhourUsageError`
 * there. If slug mode is unusable at call time (no `apiKey`), the method still
 * runs, pings are skipped, and one warning is logged.
 *
 * The client is resolved from the module registry at call time. If
 * `IonhourModule` was never initialized the method still runs, pings no-op,
 * and a one-time warning is logged.
 *
 * IMPORTANT: the wrapped method is ALWAYS invoked asynchronously — the
 * decorator replaces it with an `async` function that returns `Promise<T>`.
 * Declare decorated methods `async` (or returning `Promise<T>`) and `await`
 * their result; a previously synchronous return value becomes a promise.
 */
export function IonhourJob(job: JobRef, options: IonhourJobOptions = {}) {
  const logger = options.logger ?? defaultLogger;
  if (typeof job !== 'string') {
    validateSlug(job.slug);
  }
  let slugWarned = false;
  const warnSlugOnce = (message: string): void => {
    if (!slugWarned) {
      slugWarned = true;
      logger.warn(message);
    }
  };
  // Explicit allowlist: only ping options reach run(); decorator-only keys
  // (logger) and anything an untyped caller adds are never forwarded.
  const pingOptions: PingOptions = {
    rid: options.rid,
    durationMs: options.durationMs,
    payload: options.payload,
    host: options.host,
    env: options.env,
    exitCode: options.exitCode,
  };

  return function decorate(
    _target: object,
    _propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): void {
    const original = descriptor.value as AnyMethod;
    if (typeof original !== 'function') {
      return;
    }

    descriptor.value = async function ionhourWrapped(
      this: unknown,
      ...args: unknown[]
    ): Promise<unknown> {
      const client = getActiveIonhourClient();
      if (!client) {
        warnModuleNotInitializedOnce(logger, describeJob(job));
        return original.apply(this, args);
      }
      const coreJob =
        typeof job === 'string' ? registerOn(client, job) : tryRegisterSlug(client, job, warnSlugOnce);
      if (!coreJob) {
        return original.apply(this, args);
      }
      return coreJob.run(() => original.apply(this, args), pingOptions);
    };
  };
}
