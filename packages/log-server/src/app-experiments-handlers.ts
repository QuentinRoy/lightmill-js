import { getErrorResponse } from './api.ts';
import { DataStoreError } from './data-store-errors.ts';
import type { PathHandlers } from './router.ts';

export const experimentHandlers = (): PathHandlers<'/experiments'> => ({
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
        const { experimentId } = await store.addExperiment({ experimentName });
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
      const experiments = await store.getExperiments({
        experimentName: query['filter[name]'],
      });
      return {
        status: 200,
        body: {
          data: experiments.map((experiment) => ({
            id: experiment.experimentId,
            type: 'experiments' as const,
            attributes: { name: experiment.experimentName },
          })),
        },
      };
    },
  },

  '/experiments/{id}': {
    async get({ parameters: { path }, dataStore: store }) {
      const experiments = await store.getExperiments({ experimentId: path.id });
      if (experiments.length > 1) {
        // This should not happen, but we handle it gracefully.
        throw new Error('Multiple experiments found for the given ID');
      }
      const experiment = experiments[0];
      if (experiment == null) {
        return getErrorResponse({
          status: 'Not Found',
          detail: `Experiment "${path.id}" not found.`,
          code: 'EXPERIMENT_NOT_FOUND',
        });
      }
      return {
        status: 200,
        body: {
          data: {
            id: experiment.experimentId,
            type: 'experiments',
            attributes: { name: experiment.experimentName },
          },
        },
      };
    },
  },
});
