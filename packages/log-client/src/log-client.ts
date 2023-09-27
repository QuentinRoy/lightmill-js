import { throttle } from 'throttle-debounce';
import type { JsonValue } from 'type-fest';
import * as Interface from './log-server-interface.js';

interface Typed<Type extends string = string> {
  type: Type;
}
interface OptionallyDated {
  date?: Date;
}

type AnyLog = Record<string, JsonValue | Date | undefined> &
  Typed &
  OptionallyDated;

type ValuesSerializer<InputLog extends Typed> = (
  i: ServerLog<InputLog>['values'],
) => Record<string, JsonValue>;

type ServerLog<ClientLog extends Typed & OptionallyDated> = {
  number: number;
  type: NonNullable<ClientLog['type']>;
  values: Omit<ClientLog, 'type'> & { date: NonNullable<ClientLog['date']> };
};

export class LogClient<ClientLog extends Typed & OptionallyDated = AnyLog> {
  #logQueue: Array<ServerLog<ClientLog>> = [];
  #resolveLogQueue: (() => void) | null = null;
  #rejectLogQueue: ((error: unknown) => void) | null = null;
  #serializeValues: ValuesSerializer<ClientLog>;
  #logQueuePromise: Promise<void> | null = null;
  #runId?: string;
  #experimentId?: string;
  #apiRoot: string;
  #postLogs: throttle<() => void>;
  #runStatus: 'idle' | 'running' | 'completed' | 'canceled' = 'idle';
  #logCount = 0;

  constructor({
    experimentId,
    runId,
    apiRoot,
    serializeLog,
    requestThrottle = 500,
  }: {
    experimentId?: string;
    runId?: string;
    apiRoot: string;
    requestThrottle?: number;
  } & (Exclude<ClientLog, AnyLog> extends never
    ? // We use `Exclude` above to check if all possible `ClientLog` values
      // extends `AnyLog`'s value. `InputLog extends AnyLog` may possibly not be
      // serializable by default because `ClientLog` may contain types of values
      // that are not accepted by `AnyLog`. For example
      // { type: 't1' } | { type: 't2', x: BigInt } do extend `AnyLog` but
      // BigInt is not serializable by default. In this case, a custom
      // `serializeLog` function must be provided.
      // See https://github.com/QuentinRoy/lightmill-js/issues/138.
      { serializeLog?: ValuesSerializer<ClientLog> }
    : { serializeLog: ValuesSerializer<ClientLog> })) {
    // If serializeLog is not provided, we know that InputLog is a subset of
    // AnyLog, so we can use the default serializer.
    this.#serializeValues = serializeLog ?? anyLogSerializer;
    this.#postLogs = throttle(
      requestThrottle,
      this.#unthrottledPostLogs.bind(this),
      {
        noTrailing: false,
        noLeading: true,
      },
    );
    this.#experimentId = experimentId;
    this.#runId = runId;
    this.#apiRoot = apiRoot.endsWith('/') ? apiRoot.slice(0, -1) : apiRoot;
  }

  #isStarting = false;
  async startRun({
    resumeAfterType,
  }: { resumeAfterType?: ClientLog['type'] | ClientLog['type'][] } = {}) {
    if (this.#runStatus !== 'idle') {
      throw new Error(
        `Can only start a run when the run is idle. Run is ${this.#runStatus}`,
      );
    }
    if (this.#isStarting) {
      throw new Error('Run is already starting');
    }
    this.#isStarting = true;
    if (resumeAfterType == null) {
      return this.#startNewRun();
    }
    let sessionInfo = await Interface.getSessionInfo({
      apiRoot: this.#apiRoot,
    });
    let matchingRuns = (sessionInfo?.runs ?? []).filter(
      (r) =>
        (this.#runId == null || r.runId === this.#runId) &&
        (this.#experimentId == null || r.experimentId === this.#experimentId),
    );
    let matchingRunInfos = await Promise.all(
      matchingRuns.map((r) =>
        Interface.getRunInfo({ apiRoot: this.#apiRoot, ...r }).then(
          (r) => r.run,
        ),
      ),
    );
    matchingRunInfos = matchingRunInfos.filter(
      (r) => r.status === 'running' || r.status === 'canceled',
    );
    if (matchingRunInfos.length === 0) {
      return this.#startNewRun();
    }
    if (matchingRunInfos.length === 1) {
      let match = matchingRunInfos[0];
      return this.#resumeRun({
        runId: match.runId,
        experimentId: match.experimentId,
        logs: match.logs,
        resumeAfterType: Array.isArray(resumeAfterType)
          ? resumeAfterType
          : [resumeAfterType],
      });
    }
    throw new Error(
      `Ambiguous run to start or resume. Found ${matchingRunInfos.length} matching runs in session.`,
    );
  }

  async #startNewRun() {
    // We trust the server to return the correct type.
    let createRunResponse = await Interface.createNewRun({
      apiRoot: this.#apiRoot,
      experimentId: this.#experimentId,
      runId: this.#runId,
    });
    this.#runId = createRunResponse.runId;
    this.#experimentId = createRunResponse.experimentId;
    this.#runStatus = 'running';
  }

  async #resumeRun({
    runId,
    experimentId,
    logs,
    resumeAfterType,
  }: {
    runId: string;
    experimentId: string;
    logs: Array<{ type: string; lastNumber: number }>;
    resumeAfterType: ClientLog['type'][];
  }) {
    let lastNumber = logs
      .filter((l) => resumeAfterType.includes(l.type))
      .reduce((acc, log) => Math.max(acc, log.lastNumber), 0);
    await Interface.resumeRun({
      apiRoot: this.#apiRoot,
      runId,
      experimentId,
      resumeFrom: lastNumber + 1,
    });
    this.#runId = runId;
    this.#experimentId = experimentId;
  }

  async addLog({ type, ...values }: ClientLog) {
    if (this.#runStatus !== 'running') {
      throw new Error(
        `Can only add logs to a running run. Run is ${this.#runStatus}`,
      );
    }
    if (type == null) {
      throw new Error(
        'Trying to add a logs without a type. Logs must have a type',
      );
    }
    this.#logCount += 1;
    this.#logQueue.push({
      number: this.#logCount,
      type,
      values: { date: new Date(), ...values },
    });
    let promise = this.#logQueuePromise;
    if (promise == null) {
      this.#logQueuePromise = new Promise((resolve, reject) => {
        this.#resolveLogQueue = resolve;
        this.#rejectLogQueue = reject;
      });
      promise = this.#logQueuePromise;
    }
    this.#postLogs();
    await promise;
  }

  async #unthrottledPostLogs() {
    if (this.#rejectLogQueue == null || this.#resolveLogQueue == null) {
      throw new Error('Sending logs without a promise');
    }

    let logQueue = this.#logQueue;
    let reject = this.#rejectLogQueue;
    let resolve = this.#resolveLogQueue;
    this.#logQueuePromise = null;
    this.#resolveLogQueue = null;
    this.#rejectLogQueue = null;
    this.#logQueue = [];

    if (this.#runId == null) {
      reject(
        new Error('Internal RunLogger error: runId is null but run is started'),
      );
      return;
    }
    if (this.#experimentId == null) {
      reject(
        new Error(
          'Internal RunLogger error: experimentId is null but run is started',
        ),
      );
      return;
    }

    await Interface.postLog({
      apiRoot: this.#apiRoot,
      runId: this.#runId,
      experimentId: this.#experimentId,
      logs: logQueue.map((log) => ({
        type: log.type,
        number: log.number,
        values: this.#serializeValues(log.values),
      })),
    }).then(resolve, reject);
  }

  async flush() {
    if (this.#logQueue.length > 0) {
      this.#postLogs.cancel();
      await this.#unthrottledPostLogs();
    }
  }

  async completeRun() {
    await this.#endRun('completed');
  }

  async cancelRun() {
    await this.#endRun('canceled');
  }

  async logout() {
    await this.flush();
    await Interface.deleteSession({ apiRoot: this.#apiRoot });
  }

  async #endRun(status: 'canceled' | 'completed') {
    if (this.#runStatus !== 'running') {
      throw new Error(`Cannot end a run that is not running. Run is ${status}`);
    }
    if (this.#runId == null) {
      throw new Error(
        'Internal RunLogger error: runId is null but run is started',
      );
    }
    if (this.#experimentId == null) {
      throw new Error(
        'Internal RunLogger error: experimentId is null but run is started',
      );
    }
    this.#runStatus = status;
    await this.flush();
    await Interface.updateRunStatus({
      runId: this.#runId,
      experimentId: this.#experimentId,
      apiRoot: this.#apiRoot,
      status,
    });
  }
}

const anyLogSerializer: ValuesSerializer<AnyLog> = (obj) => {
  let result: Record<string | number | symbol, JsonValue> = {};
  // I am not using for ... of to avoid the need for the regenerator
  // runtime in older browsers.
  Object.entries(obj).forEach(([key, value]) => {
    if (value instanceof Date) {
      result[key] = value.toISOString();
    } else if (value !== undefined) {
      result[key] = value;
    }
  });
  return result;
};
