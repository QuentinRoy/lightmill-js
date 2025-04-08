type ErrorResource = { status: string; code: string; detail?: string };

export class RequestError extends Error {
  #name = 'RequestError';
  #status: number;
  #statusText: string;
  #errors: ErrorResource[];

  constructor(fetchResponse: {
    response: Response;
    error: { errors: ErrorResource[] };
  }) {
    super(
      fetchResponse.error.errors[0].detail ??
        fetchResponse.error.errors[0].code,
    );
    this.#errors = fetchResponse.error.errors;
    this.#status = fetchResponse.response.status;
    this.#statusText = fetchResponse.response.statusText;
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

export function assertNever(value: never, isCrashing: boolean = false): never {
  if (isCrashing) {
    throw new Error(`Unexpected value: ${value}`);
  }
  return value;
}
