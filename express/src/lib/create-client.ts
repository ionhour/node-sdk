import { IonhourClient } from '@ionhour/core';
import type { IonhourConfig } from '@ionhour/core';

/** Convenience factory, equivalent to `new IonhourClient(config)`. */
export function createClient(config?: IonhourConfig): IonhourClient {
  return new IonhourClient(config);
}
