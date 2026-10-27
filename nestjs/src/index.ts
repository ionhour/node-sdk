export { IonhourModule } from './lib/ionhour.module';
export { IonhourService } from './lib/ionhour.service';
export { IonhourJob } from './lib/ionhour-job.decorator';
export { IONHOUR_MODULE_OPTIONS } from './lib/constants';
export { resetIonhourRegistry } from './lib/registry';
export type {
  IonhourJobOptions,
  IonhourLogger,
  IonhourModuleAsyncOptions,
  IonhourModuleOptions,
  IonhourSlugJobTarget,
} from './lib/types';
// Re-export the core types most consumers need alongside the Nest integration.
export type { IonhourConfig, PingOptions, PingResult, SlugJobOptions } from '@ionhour/core';
