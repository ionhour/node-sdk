import { Global, Module } from '@nestjs/common';
import type { DynamicModule, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { IONHOUR_MODULE_OPTIONS } from './constants';
import { IonhourService } from './ionhour.service';
import { resetIonhourRegistry, setActiveIonhourClient } from './registry';
import type { IonhourModuleAsyncOptions, IonhourModuleOptions } from './types';

/**
 * Global module providing {@link IonhourService}. On init it seeds the
 * module-scoped registry so the `@IonhourJob` decorator can resolve a client;
 * on destroy it clears the registry so a torn-down context never leaves a
 * stale client behind (matters for consumer test suites and warm serverless).
 */
@Global()
@Module({})
export class IonhourModule implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly service: IonhourService) {}

  static forRoot(options: IonhourModuleOptions = {}): DynamicModule {
    return {
      module: IonhourModule,
      providers: [
        { provide: IONHOUR_MODULE_OPTIONS, useValue: options },
        IonhourService,
      ],
      exports: [IonhourService],
    };
  }

  static forRootAsync(options: IonhourModuleAsyncOptions): DynamicModule {
    return {
      module: IonhourModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: IONHOUR_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
        IonhourService,
      ],
      exports: [IonhourService],
    };
  }

  onModuleInit(): void {
    setActiveIonhourClient(this.service.getClient());
  }

  onModuleDestroy(): void {
    resetIonhourRegistry();
  }
}
