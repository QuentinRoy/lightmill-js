export class RequestError extends Error {
  readonly name = 'RequestError';
  readonly status: number;
  readonly statusText: string;

  constructor(response: Response, message?: string) {
    super(message);
    this.status = response.status;
    this.statusText = response.statusText;
  }
}
