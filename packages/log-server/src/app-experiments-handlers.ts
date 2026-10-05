import { DataStoreError } from './data-store-errors.ts';
import {
  getErrorResponse,
  getExperimentDocument,
  getExperimentsDocument,
} from './json-api.ts';
import type { PathHandlers } from './router.ts';

export const createExperimentHandlers = (): PathHandlers<'/experiments'> => ({
  '/experiments': {
    async post({ body, dataStore: store, sessionData, protocol, host }) {
      if (sessionData.role !== 'host') {
        return getErrorResponse({
          status: 'Forbidden',
          detail:
            'Only hosts can create experiments. Log in as a host to create an experiment.',
          code: 'FORBIDDEN',
        });
      }
      const experimentName = body.data.attributes.name;
      try {
        const { experimentId } = await store.withTransaction((tx) =>
          tx.addExperiment({ experimentName }),
        );
        return {
          status: 201,
          body: { data: { id: experimentId.toString(), type: 'experiments' } },
          headers: {
            location: `${protocol + '://' + host}/experiments/${experimentId}`,
          },
        };
      } catch (error) {
        if (
          error instanceof DataStoreError &&
          error.code === DataStoreError.EXPERIMENT_EXISTS
        ) {
          return getErrorResponse({
            status: 'Conflict',
            detail: `An experiment named "${experimentName}" already exists. Choose a different name.`,
            code: 'EXPERIMENT_EXISTS',
          });
        }
        throw error;
      }
    },

    async get({ dataStore: store, parameters: { query } }) {
      // Note: There is currently no restrictions on who can access this
      // endpoint.
      return {
        status: 200,
        body: await getExperimentsDocument(store, {
          experimentName: query['filter[name]'],
        }),
      };
    },
  },

  '/experiments/{id}': {
    async get({ parameters: { path }, dataStore: store }) {
      const document = await getExperimentDocument(store, path.id);
      if (document == null) {
        return getErrorResponse({
          status: 'Not Found',
          detail: `Experiment "${path.id}" not found.`,
          code: 'EXPERIMENT_NOT_FOUND',
        });
      }
      return { status: 200, body: document };
    },
  },
});
