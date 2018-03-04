import test from 'ava';
import { spy } from 'sinon';
import wait from 'wait-then';
import { isExperimentLoadedOnServer } from '../server-interface';

test('`isExperimentLoadedOnServer` checks if the experiment is available on the server', async t => {
  // Mock the server interface.
  const server = {
    experiments: spy(() => wait(10).then(() => ({ xp1: {}, xp2: {} })))
  };
  t.true(await isExperimentLoadedOnServer(server, 'xp1'));
  t.is(server.experiments.callCount, 1);
  t.false(await isExperimentLoadedOnServer(server, 'not-here'));
  t.is(server.experiments.callCount, 2);
});
