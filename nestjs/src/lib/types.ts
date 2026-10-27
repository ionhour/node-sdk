import type { IonhourConfig, PingOptions } from '@ionhour/core';
import type { ModuleMetadata } from '@nestjs/common';

/** Options for `IonhourModule.forRoot`. Mirrors the core client config. */
export interface IonhourModuleOptions extends IonhourConfig {}

/** Options for `IonhourModule.forRootAsync`. */
export interface IonhourModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  // `any[]` mirrors Nest's own factory-provider typing at this framework boundary.
  useFactory: (...args: any[]) => IonhourModuleOptions | Promise<IonhourModuleOptions>;
  inject?: any[];
}

/** Minimal logger surface for the single decorator warning. */
export interface IonhourLogger {
  warn(message: string): void;
}

/** Options for the `@IonhourJob` method decorator. */
export interface IonhourJobOptions extends PingOptions {
  /** Logger for the "module not initialized" warning. Defaults to `console.warn`. */
  logger?: IonhourLogger;
}

/**
 * Slug-mode target for the `@IonhourJob` decorator. Pings go to the API host
 * with the module's `apiKey` as a Bearer header; `create: true` auto-creates
 * the job on first ping (server flag `job_auto_provisioning`).
 */
export interface IonhourSlugJobTarget {
  slug: string;
  create?: boolean;
}
