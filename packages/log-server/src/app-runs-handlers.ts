import {
  canAccessRun,
  canCancelRun,
  canWriteRun,
  visibleRunIds,
} from './access.ts';
import { DataStoreError } from './data-store-errors.ts';
import {
  getErrorResponse,
  getRunDocument,
  getRunNotOwnedError,
  getRunsDocument,
} from './json-api.ts';
import type {
  HandlerResponseFromRoute,
  PathHandlers,
} from './request-handling.ts';
import {
  addRunToExperiment,
  ongoingRunStatuses,
  RunRejection,
  updateRun,
} from './run-lifecycle.ts';

export const createRunHandlers = (): PathHandlers<'/runs'> => ({
  '/runs': {
    async get({ sessionData, parameters, dataStore: store }) {
      const filter = {
        runId: visibleRunIds(sessionData, parameters.query['filter[id]']),
        runStatus: parameters.query['filter[status]'],
        experimentId: parameters.query['filter[experiment.id]'],
        experimentName: parameters.query['filter[experiment.name]'],
        runName: parameters.query['filter[name]'],
      };
      return {
        status: 200,
        body: await getRunsDocument(store, filter, parameters.query.include),
      };
    },
    async post({
      dataStore: store,
      lockSession,
      body,
      protocol,
      host,
      baseUrl,
    }) {
      const { status, name } = body.data.attributes;
      const { id: experimentId } = body.data.relationships.experiment.data;
      return lockSession(async ({ sessionData, save }) => {
        // This is not in the data transaction, which stays store-only. It does
        // not need to be: the lock keeps other creations out, and a run never
        // goes back from ended, so the answer cannot go stale.
        const ongoingRuns = await store.getRuns({
          runId: sessionData.runs,
          runStatus: ongoingRunStatuses,
        });
        if (ongoingRuns.length > 0) {
          return getErrorResponse({
            status: 'Forbidden',
            code: 'ONGOING_RUNS',
            detail: 'Client already has ongoing runs, end them first',
          });
        }
        try {
          const run = await store.withTransaction((tx) =>
            addRunToExperiment(tx, { status, experimentId, runName: name }),
          );
          await save({
            ...sessionData,
            runs: [...sessionData.runs, run.runId],
          });
          return {
            status: 201,
            body: { data: { id: run.runId, type: 'runs' } },
            headers: {
              location:
                `${protocol + '://' + host + baseUrl}/runs/${run.runId}` as const,
            },
          };
        } catch (e) {
          if (e instanceof RunRejection && e.code === 'INVALID_RUN_STATUS') {
            return getErrorResponse({
              status: 'Forbidden',
              code: 'INVALID_RUN_STATUS',
              detail: e.message,
            });
          }
          if (
            e instanceof DataStoreError &&
            e.code === DataStoreError.RUN_EXISTS
          ) {
            return getErrorResponse({
              code: 'RUN_EXISTS',
              status: 'Conflict',
              detail: `A run named ${name} already exists for experiment ${experimentId}`,
            });
          }
          if (
            e instanceof DataStoreError &&
            e.code === DataStoreError.EXPERIMENT_NOT_FOUND
          ) {
            return getErrorResponse({
              code: 'EXPERIMENT_NOT_FOUND',
              status: 'Forbidden',
              detail: `Experiment "${experimentId}" not found.`,
            });
          }
          throw e;
        }
      });
    },
  },

  '/runs/{id}': {
    async get({ sessionData, parameters, dataStore: store }) {
      if (!canAccessRun(sessionData, parameters.path.id)) {
        return getErrorResponse({
          status: 'Not Found',
          code: 'RUN_NOT_FOUND',
          detail: `Run "${parameters.path.id}" not found`,
        });
      }
      const document = await getRunDocument(
        store,
        parameters.path.id,
        parameters.query.include,
      );
      if (document === undefined) {
        return getErrorResponse({
          status: 'Not Found',
          code: 'RUN_NOT_FOUND',
          detail: `Run "${parameters.path.id}" not found`,
        });
      }
      return { status: 200, body: document };
    },

    async patch({
      sessionData,
      dataStore: store,
      body,
      parameters: {
        path: { id: runId },
      },
    }): Promise<HandlerResponseFromRoute<'/runs/{id}', 'patch'>> {
      const unknownRunAnswer = getErrorResponse({
        status: 'Not Found',
        code: 'RUN_NOT_FOUND',
        detail: `Run "${runId}" not found`,
      });
      if (!canAccessRun(sessionData, runId)) {
        return unknownRunAnswer;
      }
      const [run] = await store.getRuns({ runId });
      if (run === undefined) {
        return unknownRunAnswer;
      }
      const mayChange =
        body.data.attributes?.status === 'canceled'
          ? canCancelRun(sessionData, runId)
          : canWriteRun(sessionData, runId);
      if (!mayChange) return getErrorResponse(getRunNotOwnedError(runId));

      // Run not found errors must be handled before this.
      if (body.data.id !== runId) {
        return getErrorResponse({
          status: 'Forbidden',
          code: 'INVALID_RUN_ID',
          detail: `A run's id cannot be changed. Remove the 'id' attribute from the request body.`,
        });
      }

      // A run's name and experiment never change, so they can be checked
      // outside of the transaction updating the run.
      const newName = body.data.attributes?.name;
      if (newName !== undefined && newName !== run.runName) {
        return getErrorResponse({
          status: 'Forbidden',
          code: 'IMMUTABLE_RUN_ATTRIBUTE',
          detail: `A run's name cannot be changed. Remove the 'name' attribute from the request body.`,
          source: { pointer: '/data/attributes/name' },
        });
      }
      const newExperimentId = body.data.relationships?.experiment?.data.id;
      if (
        newExperimentId !== undefined &&
        newExperimentId !== run.experimentId
      ) {
        return getErrorResponse({
          status: 'Forbidden',
          code: 'IMMUTABLE_RUN_ATTRIBUTE',
          detail: `A run's experiment cannot be changed. Remove the 'experiment' relationship from the request body.`,
          source: { pointer: '/data/relationships/experiment' },
        });
      }

      const newRunStatus = body.data.attributes?.status;

      try {
        await store.withTransaction((tx) =>
          updateRun(tx, runId, {
            status: newRunStatus,
            resumeAfter: body.data.attributes?.lastLogNumber,
          }),
        );
      } catch (e) {
        if (!(e instanceof RunRejection)) throw e;
        switch (e.code) {
          case 'RUN_NOT_FOUND':
            return unknownRunAnswer;
          case 'INVALID_STATUS_TRANSITION':
          case 'MISSING_LOGS':
            return getErrorResponse({
              status: 'Forbidden',
              code: e.code,
              detail: e.message,
            });
          case 'INVALID_RESUME_STATUS':
          case 'INVALID_RESUME_POINT':
            return getErrorResponse({
              status: 'Forbidden',
              code: 'INVALID_LAST_LOG_NUMBER',
              detail: e.message,
            });
          default:
            throw e;
        }
      }
      const document = await getRunDocument(store, runId);
      if (document === undefined) {
        throw new Error(`Run "${runId}" not found after being updated`);
      }
      return { status: 200, body: document };
    },
  },
});
