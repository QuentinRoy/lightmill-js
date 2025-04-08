import createClient from 'openapi-fetch';
import type { components, paths } from '../generated/api.js';
import { anyLogSerializer } from './log-serializer.js';
import { LightmillLogger } from './logger.js';
import {
  AnyLog,
  LogValuesSerializer,
  OptionallyDated,
  Typed,
} from './types.js';
import { assertNever, RequestError } from './utils.js';

export class LightmillClient<
  ClientLog extends Typed & OptionallyDated = AnyLog,
> {
  #fetchClient;
  #serializeLog;

  constructor({
    apiRoot,
    serializeLog,
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
    this.#fetchClient = createClient<paths>({ baseUrl: apiRoot });
  }

  async #getSession() {
    let response = await this.#fetchClient.GET('/sessions/{id}', {
      params: { path: { id: 'current' } },
      credentials: 'include',
    });
    if (response.response.status === 404) {
      return null;
    }
    if (response.error) {
      throw new RequestError(response);
    }
    return response.data.data;
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
    let session = await this.#getSession();
    if (session?.attributes.role !== 'participant') {
      return { runs: [] };
    }
    let response = await this.#fetchClient.GET('/runs', {
      credentials: 'include',
      params: {
        query: {
          'filter[status]': ['running', 'interrupted'],
          'filter[relationships.experiment.name]': experimentName,
          'filter[name]': runName,
          include: ['lastLogs', 'experiment'],
        },
      },
    });
    if (response.error) {
      throw new RequestError(response);
    }
    const resources = response.data.included ?? [];
    const experiments = new Map<string, ExperimentResource>();
    const logs = new Map<string, LogResource>();
    for (let r of resources) {
      switch (r.type) {
        case 'experiments':
          experiments.set(r.id, r);
          break;
        case 'logs':
          logs.set(r.id, r);
          break;
        default:
          assertNever(r);
      }
    }
    return response.data.data.map((r) => {
      let experiment = experiments.get(r.relationships.experiment.data.id);
      if (experiment == null) {
        throw new Error(
          `Experiment ${r.relationships.experiment.data.id} was not included with the server's response`,
        );
      }
      let lastLogs = r.relationships.lastLogs.data.map(({ id }) => {
        let log = logs.get(id);
        if (log == null) {
          throw new Error(
            `Log ${id} was not included with the server's response`,
          );
        }
        return { type: log.attributes.logType, number: log.attributes.number };
      });
      return {
        runId: r.id,
        experimentId: experiment.id,
        runName: r.attributes.name,
        experimentName: experiment.attributes.name,
        runStatus: r.attributes.status,
        from: this.#getLastLogRecordOfType({ lastLogs, resumableLogTypes }),
      };
    });
  }

  #getLastLogRecordOfType<T extends ClientLog['type']>({
    lastLogs: logRecords,
    resumableLogTypes,
  }: {
    lastLogs: { type: string; number: number }[];
    resumableLogTypes: T[];
  }) {
    const isResumableLog = (l: { type: string }): l is { type: T } => {
      return types.includes(l.type);
    };
    let types: string[] = resumableLogTypes;
    let lastLogRecord = { number: 0, type: null as null | T };
    for (let logRecord of logRecords) {
      if (
        logRecord.number > lastLogRecord.number &&
        isResumableLog(logRecord)
      ) {
        lastLogRecord = logRecord;
      }
    }
    return { logNumber: lastLogRecord.number, logType: lastLogRecord.type };
  }

  async startRun(
    options:
      | { runName?: string; experimentName: string }
      | {
          runName: string;
          experimentName: string;
          from: { logNumber: number };
        },
  ) {
    if ('from' in options) {
      return this.#resumeRun({ ...options, from: options.from?.logNumber });
    }
    return this.#startNewRun(options);
  }

  async #getExperimentFromName(experimentName: string) {
    let response = await this.#fetchClient.GET('/experiments', {
      params: { query: { 'filter[name]': experimentName } },
    });
    if (response.data != null) return response.data.data[0];
    if (response.response.status === 404) return null;
    let error = response.error.errors[0];
    throw new Error(
      error.detail ??
        `Could not fetch experiment: server returned ${error.code}`,
    );
  }

  async #getRunFromName(
    options: { runName: string } & (
      | { experimentName: string; experimentId?: string }
      | { experimentName?: string; experimentId: string }
    ),
  ) {
    let response = await this.#fetchClient.GET('/runs', {
      params: {
        query: {
          'filter[experiment.id]': options.experimentId,
          'filter[experiment.name]': options.experimentName,
          'filter[name]': options.runName,
        },
      },
    });
    if (response.data != null) return response.data.data[0];
    if (response.response.status === 404) return null;
    let error = response.error.errors[0];
    throw new Error(
      error.detail ?? `Could not fetch run: server returned ${error.code}`,
    );
  }

  async #getRunIdFromName(
    options: { runName: string } & (
      | { experimentName: string; experimentId?: string }
      | { experimentName?: string; experimentId: string }
    ),
  ) {
    let run = await this.#getRunFromName(options);
    if (run == null) {
      throw new Error(
        `Could not find run ${options.runName} for experiment ${options.experimentName ?? options.experimentId}`,
      );
    }
    return run.id;
  }

  async #resumeRun({
    from,
    ...options
  }: (
    | { runName: string; experimentName: string }
    | { runName: string; experimentId: string }
    | { runId: string }
  ) & { from?: number }) {
    let runId: string =
      'runId' in options
        ? options.runId
        : await this.#getRunIdFromName(options);
    let response = await this.#fetchClient.PATCH('/runs/{id}', {
      credentials: 'include',
      params: { path: { id: runId } },
      body: {
        data: {
          type: 'runs',
          id: runId,
          attributes: { status: 'running', lastLogNumber: from },
        },
      },
    });
    if (response.error) {
      throw new RequestError(response);
    }
    return this.#createLogger({
      runId,
      lastLogNumber: response.data.data.attributes.lastLogNumber,
    });
  }

  async #startNewRun({
    runName,
    experimentName,
  }: {
    runName?: string;
    experimentName: string;
  }) {
    await this.#getOrCreateParticipantSession();
    let experiment = await this.#getExperimentFromName(experimentName);
    if (experiment == null) {
      throw new Error(`Couldn't find experiment ${experimentName}`);
    }
    let response = await this.#fetchClient.POST('/runs', {
      credentials: 'include',
      body: {
        data: {
          type: 'runs',
          attributes: { name: runName, status: 'running' },
          relationships: {
            experiment: { data: { id: experiment.id, type: 'experiments' } },
          },
        },
      },
    });
    if (response.error) {
      throw new RequestError(response);
    }
    const { id: runId } = response.data.data;
    return this.#createLogger({ runId, lastLogNumber: 0 });
  }

  #createLogger({
    runId,
    lastLogNumber: lastLogNumber,
  }: {
    runId: string;
    lastLogNumber: number;
  }) {
    return new LightmillLogger<ClientLog>({
      serializeLog: this.#serializeLog,
      fetchClient: this.#fetchClient,
      runId,
      lastLogNumber: lastLogNumber,
    });
  }

  async #getOrCreateParticipantSession() {
    let session = await this.#getSession();
    if (session?.attributes.role !== 'participant') {
      await this.logout();
      session = null;
    }
    if (session == null) {
      await this.#fetchClient.POST('/sessions', {
        body: {
          data: { type: 'sessions', attributes: { role: 'participant' } },
        },
      });
    }
  }

  async logout() {
    let response = await this.#fetchClient.DELETE('/sessions/{id}', {
      params: { path: { id: 'current' } },
      credentials: 'include',
    });
    if (response.error) {
      throw new RequestError(response);
    }
  }
}

type ExperimentResource = components['schemas']['Experiment.Resource'];
type LogResource = components['schemas']['Log.Resource'];
