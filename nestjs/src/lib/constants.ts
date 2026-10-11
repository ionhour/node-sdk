/**
 * Injection token for the resolved module options. Used with an explicit
 * `@Inject(IONHOUR_MODULE_OPTIONS)` so the SDK never relies on
 * `emitDecoratorMetadata` to discover the options provider.
 */
export const IONHOUR_MODULE_OPTIONS = Symbol('IONHOUR_MODULE_OPTIONS');
