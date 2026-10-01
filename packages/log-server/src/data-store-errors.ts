const dataStoreErrorCodeList = [
  'EXPERIMENT_EXISTS',
  'RUN_EXISTS',
  'LOG_NUMBER_EXISTS_IN_SEQUENCE',
  'INVALID_LOG_NUMBER',
  'EXPERIMENT_NOT_FOUND',
  'RUN_NOT_FOUND',
  'LOG_NOT_FOUND',
  'RUN_HAS_ENDED',
  'MIGRATION_FAILED',
] as const;
type DataStoreErrorCode = (typeof dataStoreErrorCodeList)[number];

export class DataStoreError extends ErrorWithCodes(dataStoreErrorCodeList) {
  /** The number of the conflicting log, set for LOG_NUMBER_EXISTS_IN_SEQUENCE. */
  logNumber: number | undefined;
  constructor(
    message: string,
    code: 'LOG_NUMBER_EXISTS_IN_SEQUENCE',
    options: ErrorOptions & { logNumber: number },
  );
  constructor(
    message: string,
    code: Exclude<DataStoreErrorCode, 'LOG_NUMBER_EXISTS_IN_SEQUENCE'>,
    options?: ErrorOptions,
  );
  constructor(
    message: string,
    code: DataStoreErrorCode,
    options?: ErrorOptions & { logNumber?: number },
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
    this.logNumber = options?.logNumber;
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
