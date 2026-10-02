const dataStoreErrorCodeList = [
  'EXPERIMENT_EXISTS',
  'RUN_EXISTS',
  'LOG_NUMBER_EXISTS_IN_SEQUENCE',
  'EXPERIMENT_NOT_FOUND',
  'RUN_NOT_FOUND',
  'LOG_NOT_FOUND',
  'TRANSACTION_CONFLICT',
  'TRANSACTION_ENDED',
  'TRANSACTION_COMMIT_FAILED',
  'TRANSACTION_ROLLBACK_FAILED',
  'STORE_CLOSED',
  'MIGRATION_FAILED',
  'SCHEMA_OUTDATED',
] as const;
type DataStoreErrorCode = (typeof dataStoreErrorCodeList)[number];

export class DataStoreError extends ErrorWithCodes(dataStoreErrorCodeList) {
  /** The number of the conflicting log, set for LOG_NUMBER_EXISTS_IN_SEQUENCE. */
  logNumber: number | undefined;
  /**
   * The error that made the transaction roll back, set for
   * TRANSACTION_ROLLBACK_FAILED (`cause` is the rollback error).
   */
  originalError: unknown;
  constructor(
    message: string,
    code: 'LOG_NUMBER_EXISTS_IN_SEQUENCE',
    options: ErrorOptions & { logNumber: number },
  );
  constructor(
    message: string,
    code: 'TRANSACTION_ROLLBACK_FAILED',
    options: ErrorOptions & { originalError: unknown },
  );
  constructor(
    message: string,
    code: Exclude<
      DataStoreErrorCode,
      'LOG_NUMBER_EXISTS_IN_SEQUENCE' | 'TRANSACTION_ROLLBACK_FAILED'
    >,
    options?: ErrorOptions,
  );
  constructor(
    message: string,
    code: DataStoreErrorCode,
    options?: ErrorOptions & { logNumber?: number; originalError?: unknown },
  ) {
    super(message, code, options);
    this.name = 'StoreError';
    // The overloads enforce this for TypeScript callers, not for JavaScript
    // ones.
    if (
      code === 'LOG_NUMBER_EXISTS_IN_SEQUENCE' &&
      options?.logNumber == null
    ) {
      throw new TypeError(`${code} requires the conflicting logNumber`);
    }
    if (
      code === 'TRANSACTION_ROLLBACK_FAILED' &&
      (options == null || !('originalError' in options))
    ) {
      throw new TypeError(`${code} requires the originalError`);
    }
    this.logNumber = options?.logNumber;
    this.originalError = options?.originalError;
  }
}

function ErrorWithCodes<const Code extends string>(codes: readonly Code[]) {
  class ErrorWithCodes extends Error {
    code: Code;
    constructor(message: string, code: Code, options?: ErrorOptions) {
      super(message, options);
      this.code = code;
    }
  }
  const storeErrorCodeMap = Object.fromEntries(
    codes.map((code) => [code, code] as const),
  );
  Object.assign(ErrorWithCodes, storeErrorCodeMap);
  return ErrorWithCodes as typeof ErrorWithCodes & { [K in Code]: K };
}
