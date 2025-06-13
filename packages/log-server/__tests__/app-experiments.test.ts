import { afterEach, describe, vi } from 'vitest';
import { apiMediaType } from '../src/app-utils.ts';
import { StoreError } from '../src/store.ts';
import { arrayify } from '../src/utils.js';
import {
  apiContentTypeRegExp,
  createSessionTest,
  isMockStore,
  storeTypes,
} from './test-utils.js';

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
      session: { api, store },
    }) => {
      if (isMockStore(store)) {
        store.addExperiment.mockImplementation(async () => {
          throw new StoreError('message', StoreError.EXPERIMENT_EXISTS);
        });
      } else {
        await store.addExperiment({ experimentName: 'exp-name' });
      }

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
        mock: async ({ store }) => {
          const experiments = ['exp-1', 'exp-2', 'exp-3'].map((id) => ({
            experimentId: id,
            experimentName: `${id}-name`,
            experimentCreatedAt: new Date('2023-01-01T00:00:00Z'),
          }));
          const runs = experiments.map(({ experimentId }, runNum) => ({
            runId: `run-${runNum + 1}`,
            experimentId: experimentId,
            runName: `run-${runNum + 1}-name`,
            runCreatedAt: new Date('2023-01-01T00:00:00Z'),
            runStatus: 'running' as const,
          }));
          store.getExperiments.mockImplementation(async () => experiments);
          store.getRuns.mockImplementation(async (filter) => {
            if (filter?.runId != null) {
              let runFilter = arrayify(filter.runId);
              return runFilter.map((runId) => {
                let experimentId = /^(exp-\d+)/.exec(runId)?.[1] ?? 'exp-?';
                return {
                  runId,
                  experimentId,
                  runName: `${runId}-name`,
                  runCreatedAt: new Date('2023-01-01T00:00:00Z'),
                  runStatus: 'running',
                };
              });
            }
            return runs;
          });
          return { experiments, runs };
        },
        sqlite: async ({ store }) => {
          vi.useFakeTimers({ now: new Date('2023-01-01T00:00:00Z') });
          const experiments = await Promise.all(
            ['exp-1-name', 'exp-2-name', 'exp-3-name'].map((name) =>
              store.addExperiment({ experimentName: name }),
            ),
          );
          const runs = await Promise.all(
            experiments.map((exp, index) => {
              return store.addRun({
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
      session: { api, store, experiments },
    }) => {
      const expNumber = 1;
      const expName = experiments[expNumber].experimentName;
      const expId = experiments[expNumber].experimentId;
      if (isMockStore(store)) {
        store.getExperiments.mockImplementation(async () => {
          return [
            {
              experimentId: expId,
              experimentName: expName,
              experimentCreatedAt: new Date('2023-01-01T00:00:00Z'),
            },
          ];
        });
      }

      await api
        .get(`/experiments?filter[name]=${expName}`)
        .expect(200, {
          data: [
            { id: expId, type: 'experiments', attributes: { name: expName } },
          ],
        })
        .expect('Content-Type', apiContentTypeRegExp);

      if (isMockStore(store)) {
        expect(store.getExperiments.mock.calls).toMatchSnapshot();
      }
    });

    it('returns empty array when no experiments match the name filter', async ({
      session: { api, store },
    }) => {
      if (isMockStore(store)) {
        store.getExperiments.mockImplementation(async (filter) => {
          if (filter?.experimentName === 'non-existent') {
            return [];
          }
          return [];
        });
      }
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
    it('returns an experiment by ID', async ({ session: { api, store } }) => {
      let experimentId = 'exp-1';
      if (isMockStore(store)) {
        store.getExperiments.mockImplementation(async (filter) => {
          if (filter?.experimentId === 'exp-1') {
            return [
              {
                experimentId,
                experimentName: 'exp-1-name',
                experimentCreatedAt: new Date('2023-01-01T00:00:00Z'),
              },
            ];
          }
          return [];
        });
      } else {
        ({ experimentId } = await store.addExperiment({
          experimentName: 'exp-1-name',
        }));
      }

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
      session: { api, store },
    }) => {
      if (isMockStore(store)) {
        store.getExperiments.mockImplementation(async () => []);
      }
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
