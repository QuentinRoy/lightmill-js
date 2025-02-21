import createClient from 'openapi-fetch';
import type { paths } from '../generated/api.js';
import { RequestError } from './utils.js';
import { LightmillLogger } from './logger.js';
import {
  AnyLog,
  OptionallyDated,
  Typed,
  LogValuesSerializer,
} from './types.js';
import { anyLogSerializer } from './log-serializer.js';

export class LightmillClient<
  ClientLog extends Typed & OptionallyDated = AnyLog,
> {
  #fetchClient;
  #serializeLog;
  #requestThrottle;

  constructor({
    apiRoot,
    serializeLog,
    requestThrottle,
  }: { apiRoot: string; requestThrottle?: number } & (Exclude<
    ClientLog,
    AnyLog
  > extends never
    ? // We use `Exclude` above to check if all possible `ClientLog` values
      // extends `AnyLog`'s value. `InputLog extends AnyLog` may possibly not be
      // serializable by default because `ClientLog` may contain types of values
      // that are not accepted by `AnyLog`. For example
      // { type: 't1' } | { type: 't2', x: BigInt } do extend `AnyLog` but
      // BigInt is not serializable by default. In this case, a custom
      // `serializeLog` function must be provided.
      // See https://github.com/QuentinRoy/lightmill-js/issues/138.
      { serializeLog?: LogValuesSerializer<ClientLog> }
    : { serializeLog: LogValuesSerializer<ClientLog> })) {
    // If serializeLog is not provided, we know that InputLog is a subset of
    // AnyLog, so we can use the default serializer.
    this.#serializeLog = serializeLog ?? anyLogSerializer;
    this.#requestThrottle = requestThrottle;
    this.#fetchClient = createClient<paths>({ baseUrl: apiRoot });
  }

  async getResumableRuns<T extends ClientLog['type']>({
    experimentName,
    runName,
    resumableLogTypes,
  }: {
    experimentName?: string;
    runName?: string;
    resumableLogTypes: T[];
  }) {
    let answer = await this.#fetchClient.GET('/sessions/current', {
      credentials: 'include',
    });
    if (answer.response.status === 404) {
      return { runs: [] };
    }
    if (answer.error) {
      throw new RequestError(answer.response, answer.error.message);
    }
    let matchingRuns = (answer.data.runs ?? []).filter(
      (r) =>
        (runName == null || r.runName === runName) &&
        (experimentName == null || r.experimentName === experimentName),
    );
    let matchingRunInfos = await Promise.all(
      matchingRuns.map(async (r) => {
        let pathParams = {
          experimentName: r.experimentName,
          runName: r.runName,
        };
        let answer = await this.#fetchClient.GET(
          '/experiments/{experimentName}/runs/{runName}',
          { credentials: 'include', params: { path: pathParams } },
        );
        if (answer.error) {
          throw new RequestError(answer.response, answer.error.message);
        }
        return answer.data;
      }),
    );
    return matchingRunInfos
      .filter(
        (r): r is typeof r & { runStatus: 'running' | 'interrupted' } =>
          r.runStatus === 'running' || r.runStatus === 'interrupted',
      )
      .map((r) => {
        return {
          runName: r.runName,
          experimentName: r.experimentName,
          runStatus: r.runStatus,
          resumesAfter: this.#getLastLogRecordOfType({
            logRecords: r.logs,
            resumableLogTypes,
          }),
        };
      });
  }

  #getLastLogRecordOfType<T extends ClientLog['type']>({
    logRecords,
    resumableLogTypes,
  }: {
    logRecords: { type: string; lastNumber: number }[];
    resumableLogTypes: T[];
  }) {
    let types: string[] = resumableLogTypes;
    let lastLogRecord = { logNumber: 0, logType: null as null | T };
    for (let logRecord of logRecords) {
      if (
        logRecord.lastNumber > lastLogRecord.logNumber &&
        types.includes(logRecord.type)
      ) {
        lastLogRecord = {
          logType: logRecord.type as T,
          logNumber: logRecord.lastNumber,
        };
      }
    }
    return lastLogRecord;
  }

  async startRun(
    options:
      | {
          runName: string;
          experimentName: string;
          resumesAfter: { logNumber: number };
        }
      | { runName?: string; experimentName?: string } = {},
  ) {
    if (!('resumesAfter' in options) || options.resumesAfter == null) {
      return this.#startNewRun(options);
    }
    return this.#resumeRun({
      ...options,
      resumeAfter: options.resumesAfter.logNumber,
    });
  }

  async #resumeRun({
    runName,
    experimentName,
    resumeAfter,
  }: {
    runName: string;
    experimentName: string;
    resumeAfter: number;
  }) {
    let response = await this.#fetchClient.PATCH(
      '/experiments/{experimentName}/runs/{runName}',
      {
        credentials: 'include',
        params: { path: { experimentName: experimentName, runName: runName } },
        body: { resumeFrom: resumeAfter + 1, runStatus: 'running' },
      },
    );
    if (response.error) {
      throw new RequestError(response.response, response.error.message);
    }
    return this.#createLogger({
      runName,
      experimentName,
      logCount: resumeAfter,
    });
  }

  async #startNewRun({
    runName,
    experimentName,
  }: {
    runName?: string;
    experimentName?: string;
  }) {
    let response = await this.#fetchClient.POST('/runs', {
      credentials: 'include',
      body: { experimentName: experimentName, runName: runName },
    });
    if (response.error) {
      throw new RequestError(response.response, response.error.message);
    }
    const { runStatus, ...loggerParams } = response.data;
    if (runStatus !== 'running') {
      throw new Error('Unexpected run status: run status is not running');
    }
    return this.#createLogger({ ...loggerParams, logCount: 0 });
  }

  #createLogger({
    runName,
    experimentName,
    logCount,
  }: {
    runName: string;
    experimentName: string;
    logCount: number;
  }) {
    return new LightmillLogger<ClientLog>({
      serializeLog: this.#serializeLog,
      requestThrottle: this.#requestThrottle,
      fetchClient: this.#fetchClient,
      runName,
      experimentName,
      logCount,
    });
  }

  async logout() {
    let response = await this.#fetchClient.DELETE('/sessions/current', {
      credentials: 'include',
    });
    if (response.error) {
      throw new RequestError(response.response, response.error.message);
    }
  }
}
