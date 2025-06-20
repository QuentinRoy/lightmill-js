import { afterEach, describe, vi } from 'vitest';
import { apiMediaType } from '../src/app-utils.ts';
import {
  apiContentTypeRegExp,
  createSessionTest,
  storeTypes,
} from './test-utils.ts';

afterEach(() => {
  vi.resetAllMocks();
});

const allTests = storeTypes
  .flatMap((storeType) => [
    { storeType, sessionType: 'host' as const },
    { storeType, sessionType: 'participant' as const },
  ])
  .map((testOptions) => ({
    ...testOptions,
    test: createSessionTest(testOptions),
  }));
const hostTests = allTests.filter((op) => op.sessionType === 'host');
const participantTests = allTests.filter(
  (op) => op.sessionType === 'participant',
);

describe.for(hostTests)(
  'LogServer: post /experiments ($sessionType session, $storeType store)',
  ({ test: it }) => {
    it('creates an experiment', async ({ session: { api } }) => {
      await api
        .post('/experiments')
        .set('Content-Type', apiMediaType)
        .send({
          data: { type: 'experiments', attributes: { name: 'exp-name' } },
        })
        .expect(201, { data: { type: 'experiments', id: '1' } })
        .expect('location', 'http://lightmill-test.com/experiments/1')
        .expect('Content-Type', apiContentTypeRegExp);
    });

    it('refuses to create an experiment if there are name conflicts', async ({
      session: { api, dataStore },
    }) => {
      await dataStore.addExperiment({ experimentName: 'exp-name' });

      await api
        .post('/experiments')
        .set('Content-Type', apiMediaType)
        .send({
          data: { type: 'experiments', attributes: { name: 'exp-name' } },
        })
        .expect(409, {
          errors: [
            {
              status: 'Conflict',
              code: 'EXPERIMENT_EXISTS',
              detail: 'An experiment named "exp-name" already exists',
            },
          ],
        })
        .expect('Content-Type', apiContentTypeRegExp);
    });
  },
);

describe.for(participantTests)(
  'LogServer: post /experiments ($sessionType session, $storeType store)',
  ({ test: it }) => {
    it('refuses to create an experiment', async ({ session: { api } }) => {
      await api
        .post('/experiments')
        .set('Content-Type', apiMediaType)
        .send({
          data: { type: 'experiments', attributes: { name: 'exp-name' } },
        })
        .expect(403, {
          errors: [
            {
              status: 'Forbidden',
              code: 'FORBIDDEN',
              detail: 'Only hosts can create experiments',
            },
          ],
        })
        .expect('Content-Type', apiContentTypeRegExp);
    });
  },
);

describe.for(allTests)(
  'LogServer: get /experiments ($sessionType session, $storeType store)',
  ({ sessionType, storeType }) => {
    const it = createSessionTest({
      sessionType,
      storeType,
      setup: {
        sqlite: async ({ dataStore }) => {
          vi.useFakeTimers({ now: new Date('2023-01-01T00:00:00Z') });
          const experiments = await Promise.all(
            ['exp-1-name', 'exp-2-name', 'exp-3-name'].map((name) =>
              dataStore.addExperiment({ experimentName: name }),
            ),
          );
          const runs = await Promise.all(
            experiments.map((exp, index) => {
              return dataStore.addRun({
                experimentId: exp.experimentId,
                runName: `run-${index + 1}-name`,
                runStatus: 'running',
              });
            }),
          );
          vi.useRealTimers();
          return { experiments, runs };
        },
      },
    });

    it('returns the list of experiments', async ({
      session: { api, experiments },
    }) => {
      await api
        .get('/experiments')
        .expect(200, {
          data: experiments.map((exp) => ({
            id: exp.experimentId,
            type: 'experiments',
            attributes: { name: exp.experimentName },
          })),
        })
        .expect('Content-Type', apiContentTypeRegExp);
    });

    it('filters experiments by name when given filter[name] parameter', async ({
      expect,
      session: { api, dataStore, experiments },
    }) => {
      const expNumber = 1;
      const expName = experiments[expNumber]!.experimentName;
      const expId = experiments[expNumber]!.experimentId;
      await api
        .get(`/experiments?filter[name]=${expName}`)
        .expect(200, {
          data: [
            { id: expId, type: 'experiments', attributes: { name: expName } },
          ],
        })
        .expect('Content-Type', apiContentTypeRegExp);

      expect(dataStore.getExperiments.mock.calls).toMatchSnapshot();
    });

    it('returns empty array when no experiments match the name filter', async ({
      session: { api },
    }) => {
      await api
        .get('/experiments?filter[name]=non-existent')
        .expect(200, { data: [] })
        .expect('Content-Type', apiContentTypeRegExp);
    });
  },
);

describe.for(allTests)(
  'LogServer: get /experiments/{id} ($sessionType session, $storeType store)',
  ({ test: it }) => {
    it('returns an experiment by ID', async ({
      session: { api, dataStore },
    }) => {
      let { experimentId } = await dataStore.addExperiment({
        experimentName: 'exp-1-name',
      });

      await api
        .get(`/experiments/${experimentId}`)
        .expect(200, {
          data: {
            id: experimentId,
            type: 'experiments',
            attributes: { name: 'exp-1-name' },
          },
        })
        .expect('Content-Type', apiContentTypeRegExp);
    });

    it('returns 404 for non-existent experiment', async ({
      session: { api },
    }) => {
      await api
        .get('/experiments/non-existent')
        .expect(404, {
          errors: [
            {
              status: 'Not Found',
              code: 'EXPERIMENT_NOT_FOUND',
              detail: 'Experiment non-existent not found',
            },
          ],
        })
        .expect('Content-Type', apiContentTypeRegExp);
    });
  },
);
