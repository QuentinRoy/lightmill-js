import * as React from 'react';
import { DownloadLogsLink } from './defaultPaused.js';
import { useLogDelivery } from './useLogDelivery.js';
import { runErrorContext } from './useRunError.js';

const maxCauses = 5;

// Duck-typed: the error is whatever was thrown, and react-experiment does not
// import log-client's error classes.
function getProperty(error: unknown, key: string): unknown {
  return typeof error === 'object' && error != null
    ? Reflect.get(error, key)
    : undefined;
}

function sentenceFor(error: unknown): string {
  switch (getProperty(error, 'code')) {
    case 'RUN_EXISTS':
      return 'A session with this name already exists. It may already be running on this device.';
    case 'ONGOING_RUNS':
      return 'You already have a session in progress, perhaps in another tab or on another device.';
    default:
      return 'The experiment could not continue because of an unexpected error. Contact the experimenter and give them the details below.';
  }
}

// Not every engine puts the message in the stack.
function describe(error: unknown): string {
  const text = String(error);
  if (!(error instanceof Error) || !error.stack) return text;
  return error.stack.includes(text) ? error.stack : `${text}\n${error.stack}`;
}

function formatDetails(
  error: unknown,
  { experimentName, runName }: { experimentName: string; runName: string },
): string {
  const lines = [`Experiment: ${experimentName}`, `Run: ${runName}`];
  const code = getProperty(error, 'code');
  const status = getProperty(error, 'status');
  if (typeof code === 'string') lines.push(`Code: ${code}`);
  if (typeof status === 'number') lines.push(`Status: ${status}`);
  lines.push('', describe(error));
  let cause = getProperty(error, 'cause');
  for (let depth = 0; cause != null && depth < maxCauses; depth++) {
    lines.push('', 'Caused by:', describe(cause));
    cause = getProperty(cause, 'cause');
  }
  return lines.join('\n');
}

export function DefaultError(): React.JSX.Element {
  const context = React.useContext(runErrorContext);
  if (context == null) throw new Error('DefaultError is rendered by <Run />');
  const { error: deliveryError, retry } = useLogDelivery();
  return (
    <div>
      <p>{sentenceFor(context.error)}</p>
      <details>
        <summary>Details for the experimenter</summary>
        <pre>{formatDetails(context.error, context)}</pre>
      </details>
      <DownloadLogsLink />
      {deliveryError != null && (
        <button onClick={() => void retry()}>Retry</button>
      )}
    </div>
  );
}
