import { IonhourClient } from '@ionhour/core';
import type { IonhourJob, PingOptions, PingResult, SlugJobOptions } from '@ionhour/core';
import { Inject, Injectable } from '@nestjs/common';
import { IONHOUR_MODULE_OPTIONS } from './constants';
import type { IonhourModuleOptions } from './types';

/**
 * Thin NestJS wrapper around a single `IonhourClient`. Register jobs and send
 * pings by token. Like the core client, ping methods never throw on transport
 * problems.
 */
@Injectable()
export class IonhourService {
  private readonly client: IonhourClient;

  constructor(@Inject(IONHOUR_MODULE_OPTIONS) options: IonhourModuleOptions) {
    this.client = new IonhourClient(options);
  }

  /** The underlying core client (used by the module to seed the registry). */
  getClient(): IonhourClient {
    return this.client;
  }

  registerJob(token: string): IonhourJob {
    return this.client.registerJob(token);
  }

  /**
   * Slug mode: register a job by slug in the `apiKey`'s workspace. Pings go
   * to the API host with the Bearer key. Throws `IonhourUsageError` on an
   * invalid slug or a missing `apiKey`.
   */
  registerJobBySlug(slug: string, options?: SlugJobOptions): IonhourJob {
    return this.client.registerJobBySlug(slug, options);
  }

  success(token: string, options?: PingOptions): Promise<PingResult> {
    return this.client.registerJob(token).success(options);
  }

  fail(token: string, options?: PingOptions): Promise<PingResult> {
    return this.client.registerJob(token).fail(options);
  }

  run<T>(token: string, fn: () => T | Promise<T>, options?: PingOptions): Promise<T> {
    return this.client.registerJob(token).run(fn, options);
  }
}
