import type { RegisteredLog } from './config.js';

export class LogDeliveryError<Log = RegisteredLog> extends Error {
  override name = 'LogDeliveryError';
  // The log that could not be delivered, if any, so the app can recover it.
  readonly log?: Log;
  constructor(message: string, options?: ErrorOptions & { log?: Log }) {
    super(message, options);
    this.log = options?.log;
  }
}
