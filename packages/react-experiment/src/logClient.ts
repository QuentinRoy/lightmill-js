import type { RegisteredLog } from './config.js';

// The part of @lightmill/log-client that Run uses, declared here so
// react-experiment imports nothing from it at runtime. A type-level test
// assigns a real Client and Logger to these interfaces to catch drift.

export type LoggerState =
  | Readonly<{ status: 'idle' | 'sending' }>
  | Readonly<{ status: 'retrying' | 'paused'; error: Error }>
  | Readonly<{ status: 'completed' | 'canceled' | 'interrupted' }>;

export interface RunLogger<Log extends { type: string } = RegisteredLog> {
  addLog(log: Log): Promise<void>;
  readonly state: LoggerState;
  subscribe: (listener: (state: LoggerState) => void) => () => void;
  readonly inFlightLogs: ReadonlyArray<Log>;
  flush(): Promise<void>;
  retry(): Promise<void>;
  completeRun(): Promise<void>;
  interruptRun(): Promise<void>;
}

// Logs come back from the server as JSON, so dates are strings.
type DatesAsStrings<T> = T extends Date
  ? string
  : T extends Array<infer U>
    ? DatesAsStrings<U>[]
    : T extends object
      ? { [K in keyof T]: DatesAsStrings<T[K]> }
      : T;

export type ResumeLog<Log extends { type: string } = RegisteredLog> =
  DatesAsStrings<Log>;

export interface RunClient<Log extends { type: string } = RegisteredLog> {
  getResumableRuns(options: {
    experimentName: string;
    runName: string;
    resumableLogTypes: Array<Log['type']>;
  }): Promise<
    Array<{
      run: { id: string; name: string | null; status: string };
      toResumeAfter:
        { number: 0; log: null } | { number: number; log: ResumeLog<Log> };
    }>
  >;
  startRun(
    options:
      | { experimentName: string; runName: string }
      // `after` is what getResumableRuns returns as `toResumeAfter`.
      | { runId: string; after: { number: number } },
  ): Promise<RunLogger<Log>>;
}
