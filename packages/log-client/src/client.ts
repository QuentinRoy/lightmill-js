import type { components, paths } from '@lightmill/log-api';
import createClient from 'openapi-fetch';
import { anyLogSerializer } from './log-serializer.js';
import { LightmillLogger } from './logger.js';
import type {
  AnyLog,
  GetLogValuesWithType,
  LogBase,
  LogValuesSerializer,
} from './types.js';
import { assertNever, RequestError } from './utils.js';
import { apiMediaType } from './utils.ts';

export class LightmillClient<ClientLog extends LogBase = AnyLog> {
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
    if (session == null) {
      return [];
    }
    let response = await this.#fetchClient.GET('/runs', {
      credentials: 'include',
      params: {
        query: {
          'filter[status]': ['running', 'interrupted'],
          'filter[experiment.name]': experimentName,
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
    // This could be better optimized by fetching all logs in one go,
    // but there should always be only one resumable run anyway, so
    // this is not a big deal.
    return Promise.all(
      response.data.data.map(async (r) => {
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
          return {
            id,
            type: log.attributes.logType,
            number: log.attributes.number,
            values: log.attributes.values,
          };
        });
        let logToResumeAfter = await this.#getLastResumableLog<T>({
          lastLogs,
          resumableLogTypes,
        });
        return {
          run: {
            id: r.id,
            name: r.attributes.name,
            status: r.attributes.status,
          },
          experiment: { id: experiment.id, name: experiment.attributes.name },
          toResumeAfter: logToResumeAfter,
        };
      }),
    );
  }

  async #getLastResumableLog<T extends ClientLog['type']>({
    lastLogs: logRecords,
    resumableLogTypes,
  }: {
    lastLogs: {
      type: string;
      number: number;
      id: string;
      values: Record<string, unknown>;
    }[];
    resumableLogTypes: T[];
  }): Promise<
    | { number: 0; log: null }
    | { number: number; log: GetLogValuesWithType<ClientLog & { type: T }> }
  > {
    const isResumableLog = (l: { type: string }): l is { type: T } => {
      return types.includes(l.type);
    };
    let types: string[] = resumableLogTypes;
    let lastLogRecord:
      | { number: 0; type: null; id: null; values: null }
      | {
          number: number;
          type: T;
          id: string;
          values: Record<string, unknown>;
        } = { number: 0, type: null, id: null, values: null };
    for (let logRecord of logRecords) {
      if (
        logRecord.number > lastLogRecord.number &&
        isResumableLog(logRecord)
      ) {
        lastLogRecord = logRecord;
      }
    }
    if (lastLogRecord.type == null || lastLogRecord.id == null) {
      return { number: 0, log: null };
    }
    return {
      number: lastLogRecord.number,
      // @ts-expect-error we trust the server to return the correct values
      // with the correct type.
      log: { ...lastLogRecord.values, type: lastLogRecord.type },
    };
  }

  async startRun(
    options:
      | {
          experimentName: string;
          // We cannot resume a run that has no name.
          runName?: undefined;
          after?: undefined;
        }
      // `after` is an object so it can be directly fed with the result of
      // getResumableRuns.
      | { experimentName: string; runName: string; after?: { number: number } }
      // run id can only be used to resume a run, so from is required (even
      // if it's 0).
      | { runId: string; after: { number: number } },
  ) {
    if (options.after != null) {
      return this.#resumeRun({ ...options, after: options.after.number });
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
    after,
    ...options
  }: (
    | { runName: string; experimentName: string; runId?: undefined }
    | { runName: string; experimentId: string; runId?: undefined }
    | { runId: string }
  ) & { after: number }) {
    let runId: string =
      options.runId ?? (await this.#getRunIdFromName(options));
    let response = await this.#fetchClient.PATCH('/runs/{id}', {
      credentials: 'include',
      params: { path: { id: runId } },
      headers: { 'content-type': apiMediaType },
      body: {
        data: {
          type: 'runs',
          id: runId,
          attributes: { status: 'running', lastLogNumber: after },
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
    await this.#getOrCreateSession();
    let experiment = await this.#getExperimentFromName(experimentName);
    if (experiment == null) {
      throw new Error(`Couldn't find experiment ${experimentName}`);
    }
    let response = await this.#fetchClient.POST('/runs', {
      credentials: 'include',
      headers: { 'content-type': apiMediaType },
      body: {
        data: {
          type: 'runs',
          attributes: { name: runName ?? null, status: 'running' },
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

  async #getOrCreateSession() {
    let session = await this.#getSession();
    if (session == null) {
      await this.#fetchClient.POST('/sessions', {
        headers: { 'content-type': apiMediaType },
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
