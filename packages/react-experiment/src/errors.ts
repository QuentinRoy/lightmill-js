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

const remountFix =
  'Keep `Run` mounted, with the same client, experiment name and run name, until the run ends. Reloading the page resumes the run.';

/**
 * A started run cannot continue in a new `Run`: the task in progress lost its
 * state, and playing it again would log on top of its first attempt.
 */
export class RunRemountedError extends Error {
  override name = 'RunRemountedError';
  readonly code = 'RUN_REMOUNTED';
  constructor(reason: 'remount' | 'identity') {
    super(
      reason === 'remount'
        ? `Run was remounted after the run started. The task in progress lost its state, so the run was stopped and interrupted. A \`key\` change, conditional rendering, or, during development, a Fast Refresh after a hook change in a component above Run or a new client object remounts it. ${remountFix}`
        : `Run's client, experiment name or run name changed after the run started, so the run was stopped and interrupted. ${remountFix}`,
    );
  }
}

/**
 * The timeline yielded a task it cannot: one whose id is already used or, when
 * a resumed run is replayed, another task than the one the run completed at
 * that step, or none.
 */
export class TimelineMismatchError extends Error {
  override name = 'TimelineMismatchError';
  readonly code = 'TIMELINE_MISMATCH';
}
