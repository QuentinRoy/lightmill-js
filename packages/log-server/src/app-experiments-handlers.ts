import {
  getErrorResponse,
  type ServerHandlerBody,
  type ServerHandlerResult,
  type SubServerDescription,
} from './app-utils.js';
import { StoreError } from './store-errors.ts';

export const experimentHandlers = (): SubServerDescription<'/experiments'> => ({
  '/experiments': {
    async post({
      body,
      store,
      request,
    }): Promise<ServerHandlerResult<'/experiments', 'post'>> {
      if (request.session.data?.role !== 'host') {
        return getErrorResponse({
          status: 403,
          detail: 'Only hosts can create experiments',
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
            location: `${request.protocol + '://' + request.get('host')}/experiments/${experimentId}`,
          },
        };
      } catch (error) {
        if (
          error instanceof StoreError &&
          error.code === StoreError.EXPERIMENT_EXISTS
        ) {
          return getErrorResponse({
            status: 409,
            detail: `An experiment named "${experimentName}" already exists`,
            code: 'EXPERIMENT_EXISTS',
          });
        }
        throw error;
      }
    },

    async get({ store, parameters: { query } }) {
      const experiments = await store.getExperiments({
        experimentName: query['filter[name]'],
      });
      const data: Extract<
        ServerHandlerBody<'/experiments', 'get'>,
        { data: unknown }
      >['data'] = [];
      for (const experiment of experiments) {
        data.push({
          id: experiment.experimentId,
          type: 'experiments',
          attributes: { name: experiment.experimentName },
        });
      }
      return { status: 200, body: { data } };
    },
  },

  '/experiments/{id}': {
    async get({ request, parameters: { path }, store }) {
      if (request.session.data == null) {
        throw new Error('Session data is not initialized');
      }
      const experiments = await store.getExperiments({ experimentId: path.id });
      if (experiments.length > 1) {
        throw new Error('Multiple experiments found for the given ID');
      }
      const experiment = experiments[0];
      const notFoundErrorResponse = getErrorResponse({
        status: 404,
        detail: `Experiment ${path.id} not found`,
        code: 'EXPERIMENT_NOT_FOUND',
      });
      if (experiment == null) {
        return notFoundErrorResponse;
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
