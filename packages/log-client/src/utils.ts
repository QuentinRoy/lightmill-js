type ErrorResource = { status: string; code?: string; detail?: string };

export class RequestError extends Error {
  #name = 'RequestError';
  #status: number;
  #statusText: string;
  #headers: Headers;
  #errors: ErrorResource[];

  constructor(fetchResponse: {
    response: Response;
    error: string | { errors: ErrorResource[] };
  }) {
    const { response, error } = fetchResponse;
    // HTTP/2 has no reason phrase, so statusText is empty there.
    const statusText = response.statusText || `HTTP ${response.status}`;
    // A body without errors (e.g. from a proxy) gets the same status-based
    // error as a failed response without a body, so `detail` and `code` stay
    // readable.
    const errors =
      typeof error === 'string'
        ? error !== ''
          ? [{ status: statusText, detail: error }]
          : []
        : (error.errors ?? []);
    const first = errors[0] ?? { status: statusText };
    super(first.detail ?? first.code ?? first.status);
    this.#errors = errors.length > 0 ? errors : [first];
    this.#status = response.status;
    this.#statusText = response.statusText;
    this.#headers = response.headers;
  }

  get headers() {
    return this.#headers;
  }

  get errors() {
    return this.#errors;
  }

  get name() {
    return this.#name;
  }

  get status() {
    return this.#status;
  }

  get statusText() {
    return this.#statusText;
  }

  get detail() {
    return this.errors[0].detail;
  }

  get code() {
    return this.errors[0].code;
  }
}

type FetchResult = {
  data?: unknown;
  error?: ConstructorParameters<typeof RequestError>[0]['error'];
  response: Response;
};
// The data of the successful member of an openapi-fetch result union. Inferring
// it from the parameter instead would give `T | undefined`, because the failed
// member has `data?: never`.
type SuccessData<R extends FetchResult> = R extends {
  data: infer D;
  error?: never;
}
  ? D
  : never;

/**
 * Returns the data of a successful openapi-fetch result, and throws a
 * RequestError for a failed one. The return type holds because of that check:
 * a result that passes it is the successful member of the union.
 */
export function unwrap<R extends FetchResult>(result: R): SuccessData<R>;
export function unwrap(result: FetchResult): unknown {
  // openapi-fetch leaves `error` undefined for a failed response without a
  // body, so `error` alone would let it through as a success.
  if (result.error !== undefined || !result.response.ok) {
    throw new RequestError({
      response: result.response,
      error: result.error ?? '',
    });
  }
  return result.data;
}

export function assertNever(value: never, isCrashing: boolean = false): never {
  if (isCrashing) {
    throw new Error(`Unexpected value: ${value}`);
  }
  return value;
}

export function toError(error: unknown) {
  return error instanceof Error
    ? error
    : new Error('Unknown error', { cause: error });
}
