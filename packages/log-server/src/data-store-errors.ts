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
  constructor(
    message: string,
    code: DataStoreErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, code, options);
    this.name = 'StoreError';
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
