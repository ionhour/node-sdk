import type { IonhourClient } from '@ionhour/core';
import type { IonhourLogger } from './types';

/**
 * Module-scoped registry the `@IonhourJob` decorator resolves against.
 * `IonhourModule` populates it in `onModuleInit`. A method decorator cannot
 * receive DI, so this module-level singleton bridges the two.
 */
let activeClient: IonhourClient | undefined;
let hasWarned = false;

export function setActiveIonhourClient(client: IonhourClient): void {
  activeClient = client;
  hasWarned = false;
}

export function getActiveIonhourClient(): IonhourClient | undefined {
  return activeClient;
}

/** Clears the registry. Exposed for test isolation in consumer apps. */
export function resetIonhourRegistry(): void {
  activeClient = undefined;
  hasWarned = false;
}

/**
 * Warn once that decorated methods run without pings. `label` identifies the
 * job; callers pass a slug or an already-redacted token prefix, never the raw
 * token (it is a credential).
 */
export function warnModuleNotInitializedOnce(logger: IonhourLogger, label: string): void {
  if (hasWarned) {
    return;
  }
  hasWarned = true;
  logger.warn(
    `[ionhour] @IonhourJob(${label}) executed but IonhourModule was not ` +
      'initialized; heartbeat pings are disabled for decorated methods.',
  );
}
