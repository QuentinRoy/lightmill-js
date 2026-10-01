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
// more than retryDurationMs after the first failure, or signal aborts. Each
// attempt resends the same request and is aborted after timeoutMs or when
// signal aborts.
export async function sendWithRetries<T>(
  send: (signal: AbortSignal) => Promise<T>,
  {
    timeoutMs,
    signal,
    onRetry = () => {},
  }: {
    timeoutMs: number;
    signal?: AbortSignal;
    onRetry?: (retry: Retry) => void;
  },
): Promise<T> {
  let firstFailure: number | null = null;
  for (let attempt = 1; ; attempt++) {
    let error: Error;
    try {
      return await sendWithTimeout(send, timeoutMs, signal);
    } catch (caughtError) {
      error = toError(caughtError);
      if (!isRetriable(error) || signal?.aborted) throw error;
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
    if (signal?.aborted) throw error;
  }
}

// AbortSignal.any() and AbortSignal#reason would be shorter, but they would
// raise the browser baseline (see the README).
async function sendWithTimeout<T>(
  send: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<T> {
  const controller = new AbortController();
  let abortError: DOMException | null = null;
  const abort = (error: DOMException) => {
    abortError ??= error;
    controller.abort();
  };
  const timeout = setTimeout(() => {
    abort(
      new DOMException(
        `The server did not answer within ${Math.round(timeoutMs)} ms`,
        'TimeoutError',
      ),
    );
  }, timeoutMs);
  const abortWithSignal = () => {
    abort(new DOMException('The request was aborted', 'AbortError'));
  };
  signal?.addEventListener('abort', abortWithSignal, { once: true });
  if (signal?.aborted) abortWithSignal();
  try {
    return await send(controller.signal);
  } catch (error) {
    throw abortError ?? error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortWithSignal);
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
