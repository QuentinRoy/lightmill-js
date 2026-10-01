import { RequestError, toError } from './utils.js';

const retryBaseDelayMs = 250;
const retryMaxDelayMs = 10_000;
const retryDurationMs = 2 * 60_000;

export interface Retry {
  error: Error;
  attempt: number;
  delayMs: number;
}

// Sends a request again after network errors, timeouts, 5xx, 408 and 429,
// until it succeeds, fails with another status, the next attempt would start
// more than retryDurationMs after the first failure, or isCanceled returns
// true. Each attempt resends the same request and is aborted after timeoutMs.
export async function sendWithRetries<T>(
  send: (signal: AbortSignal) => Promise<T>,
  {
    timeoutMs,
    isCanceled = () => false,
    onRetry = () => {},
  }: {
    timeoutMs: number;
    isCanceled?: () => boolean;
    onRetry?: (retry: Retry) => void;
  },
): Promise<T> {
  let firstFailure: number | null = null;
  for (let attempt = 1; ; attempt++) {
    let error: Error;
    try {
      return await sendWithTimeout(send, timeoutMs);
    } catch (caughtError) {
      error = toError(caughtError);
      if (!isRetriable(error) || isCanceled()) throw error;
    }
    firstFailure ??= Date.now();
    const backoffMs =
      Math.random() *
      Math.min(retryMaxDelayMs, retryBaseDelayMs * 2 ** (attempt - 1));
    // Retry-After only delays attempts, so a Retry-After of 0 cannot make
    // them skip the backoff.
    const delayMs = Math.max(getRetryAfterMs(error) ?? 0, backoffMs);
    // Checked against the next attempt rather than now, so a long Retry-After
    // gives up at once instead of leaving the caller retrying.
    if (Date.now() + delayMs - firstFailure > retryDurationMs) throw error;
    onRetry({ error, attempt, delayMs });
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (isCanceled()) throw error;
  }
}

async function sendWithTimeout<T>(
  send: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(
      new DOMException(
        `The server did not answer within ${Math.round(timeoutMs)} ms`,
        'TimeoutError',
      ),
    );
  }, timeoutMs);
  try {
    return await send(controller.signal);
  } catch (error) {
    throw controller.signal.aborted ? controller.signal.reason : error;
  } finally {
    clearTimeout(timeout);
  }
}

function isRetriable(error: Error) {
  // Any other error means no response came back: the network failed or the
  // request timed out, which a later attempt may get past. An unexpected
  // error is retried too, which costs little: retries stop after
  // retryDurationMs.
  if (!(error instanceof RequestError)) return true;
  return error.status >= 500 || error.status === 408 || error.status === 429;
}

function getRetryAfterMs(error: Error) {
  if (!(error instanceof RequestError)) return null;
  const header = error.headers.get('retry-after');
  if (header == null || header.trim() === '') return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}
