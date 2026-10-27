import type { IonhourLogger } from './types';

/**
 * Default logger for the one decorator warning. This is the only place the SDK
 * writes to the console; everything else is silent by design.
 */
export const defaultLogger: IonhourLogger = {
  warn: (message: string) => {
    // eslint-disable-next-line no-console
    console.warn(message);
  },
};
