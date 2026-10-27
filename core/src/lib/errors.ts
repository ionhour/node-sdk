/**
 * Thrown for programmer errors (empty token, oversized or non-serializable
 * payload). Per the contract these fail loudly at call time; transport
 * problems never throw and are reported via `PingResult` / `onError`.
 */
export class IonhourUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IonhourUsageError';
    // Restore the prototype chain for `instanceof` under transpiled targets.
    Object.setPrototypeOf(this, IonhourUsageError.prototype);
  }
}
