import wait from 'wait-then';
import deferred from 'promise.defer';
import RunInterface, {
  connectToRun,
  selectRun,
  checkExperimentAndImportIfNeeded,
  consolidateRun
} from '../run-interface';

const spyDelay = (result, delay = 0) =>
  jest.fn(() => wait(delay).then(() => result));

describe('selectRun', () => {
  it('asks for an available run if no run is provided', async () => {
    const server = { availableRun: spyDelay({ experimentId: 'xpid' }) };
    expect(await selectRun(server, 'xpid')).toEqual({ experimentId: 'xpid' });
    expect(server.availableRun).toMatchSnapshot();
  });

  it('asks for the specified run if it is provided', async () => {
    const server = { run: spyDelay({ experimentId: 'xpid', id: 'runid' }) };
    expect(await selectRun(server, 'xpid', 'runid')).toEqual({
      experimentId: 'xpid',
      id: 'runid'
    });
    expect(server.run).toMatchSnapshot();
  });

  it('throws if the experiment ids do not match', async () => {
    const server = {
      availableRun: spyDelay({ id: 'runid', experimentId: 'xpid' }),
      run: spyDelay({ id: 'runid', experimentId: 'xpid' })
    };
    await expect(selectRun(server, 'other-xp-id')).rejects.toThrow(
      'Received experiment id is inconsistent with the one that has been requested.'
    );
  });

  it('throws if the run ids do not match', async () => {
    const server = {
      availableRun: spyDelay({ id: 'runid', experimentId: 'xpid' }),
      run: spyDelay({ id: 'runid', experimentId: 'xpid' })
    };
    await expect(selectRun(server, 'xpid', 'other-run-id')).rejects.toThrow(
      'Received run id is inconsistent with the one that has been requested.'
    );
  });
});

describe('connectToRun', () => {
  it("properly locks, ask for run's plan and for run's current trial when no run is specified", async () => {
    const server = {
      lock: spyDelay({ token: 'lock' }).mockName('server#lock'),
      plan: spyDelay(['block1', 'block2']).mockName('server#plan'),
      currentTrial: spyDelay({ number: 5, blockNumber: 10 }).mockName(
        'server#currentTrial'
      )
    };
    const result = await connectToRun(server, {
      id: 'runid',
      experimentId: 'xpid'
    });
    expect(server.lock).toMatchSnapshot();
    expect(server.plan).toMatchSnapshot();
    expect(server.currentTrial).toMatchSnapshot();
    expect(result).toEqual({
      id: 'runid',
      experimentId: 'xpid',
      blocks: ['block1', 'block2'],
      currentTrial: { number: 5, blockNumber: 10 },
      lock: { token: 'lock' }
    });
  });
});

describe('checkExperimentAndImportIfNeeded', () => {
  it('checks for an experiment on the server and does nothing if it is loaded', async () => {
    const loadedDef = deferred();
    const server = {
      isExperimentLoadedOnServer: jest.fn(() => loadedDef.promise)
    };
    const pr = checkExperimentAndImportIfNeeded(server, 'xp');
    expect(server.isExperimentLoadedOnServer.mock.calls).toEqual([['xp']]);
    loadedDef.resolve(true);
    await pr;
  });

  it('checks for an experiment on the server and load it if it is not loaded', async () => {
    const loadedDef = deferred();
    const importedDef = deferred();
    const server = {
      isExperimentLoadedOnServer: jest
        .fn(() => loadedDef.promise)
        .mockName('server#isExperimentLoadedOnServer'),
      importExperimentOnServer: jest
        .fn(() => importedDef.promise)
        .mockName('server#importExperimentOnServer')
    };
    const pr = checkExperimentAndImportIfNeeded(
      server,
      'xp',
      'http://host.path:1234/design.xml'
    );
    expect(server.isExperimentLoadedOnServer).toMatchSnapshot();
    expect(server.importExperimentOnServer).toMatchSnapshot();
    loadedDef.resolve(false);
    await wait();
    expect(server.importExperimentOnServer).toMatchSnapshot();
    importedDef.resolve();
    await pr;
  });

  it('fails without trying to import if it is not loaded and its design URI is not provided', async () => {
    const server = {
      isExperimentLoadedOnServer: spyDelay(false).mockName(
        'server#isExperimentLoadedOnServer'
      ),
      importExperimentOnServer: jest
        .fn()
        .mockName('server#importExperimentOnServer')
    };
    const pr = checkExperimentAndImportIfNeeded(server, 'xp');
    await expect(pr).rejects.toThrow();
    expect(server.isExperimentLoadedOnServer).toMatchSnapshot();
    expect(server.importExperimentOnServer).toMatchSnapshot();
  });
});

const makeRunPlan = () => ({
  id: 'runid',
  experimentId: 'xpid',
  blocks: [
    {
      values: { bval1: 'b11', bval2: 'b12' },
      number: 0,
      trials: [
        { values: { tval1: 't111', tval2: 't112' }, number: 0 },
        { values: { tval1: 't121', tval2: 't122' }, number: 1 }
      ]
    },
    {
      values: { bval1: 'b21', bval2: 'b22' },
      number: 1,
      trials: [
        { values: { tval1: 't211', tval2: 't212' }, number: 0 },
        { values: { tval1: 't221', tval2: 't222' }, number: 1 }
      ]
    }
  ]
});

describe('consolidateRun', () => {
  it('properly inserts backrefs.', () => {
    expect.assertions(6);
    const run = consolidateRun(makeRunPlan());
    run.blocks.forEach(block => {
      expect(block.run).toBe(run);
      block.trials.forEach(trial => {
        expect(trial.block).toBe(block);
      });
    });
  });
});

const makeRCon = ({
  run = consolidateRun(makeRunPlan()),
  token = '',
  trial = 0,
  block = 0,
  queue = {
    push: spyDelay(),
    flush: spyDelay()
  },
  post = spyDelay()
} = {}) => ({
  run,
  queue,
  post,
  rcon: new RunInterface(run, token, block, trial, queue, post)
});

describe('RunInterface', () => {
  it('finds the first trial', async () => {
    const { rcon, run } = makeRCon({ trial: 0, block: 1 });
    expect(run.blocks[1].trials[0]).toBe(await rcon.getCurrentTrial());
    expect(await rcon.getCurrentBlock()).toBe(run.blocks[1]);
  });

  it('finds the next trial when on the same block', async () => {
    const { rcon } = makeRCon({ trial: 0, block: 1 });
    const next = await rcon.getNextTrial();
    expect(next.number).toBe(1);
    expect(next.block.number).toBe(1);
  });

  it('finds the next trial when on the next block', async () => {
    const { rcon } = makeRCon({ trial: 1, block: 0 });
    const next = await rcon.getNextTrial();
    expect(next.number).toBe(0);
    expect(next.block.number).toBe(1);
  });

  it('#getNextTrial resolves with undefined when on the last trial', async () => {
    const { rcon } = makeRCon({ trial: 1, block: 1 });
    expect(await rcon.getNextTrial()).toBe(undefined);
  });

  it('#postResults properly posts the measures', async () => {
    const { rcon, post } = makeRCon({ token: 'token' });
    await rcon.postResults({ val: 'val' });
    expect(post).toMatchSnapshot();
  });

  it('#postResults throws if called twice on the same trial', async () => {
    const { rcon } = makeRCon();
    rcon.postResults({ val: 'val' });
    await expect(rcon.postResults({ val: 'other val' })).rejects.toThrow();
  });

  it('#postResults throws if post failed', async () => {
    const { rcon } = makeRCon({
      post: jest.fn(() =>
        wait().then(() => {
          throw new Error('test err');
        })
      )
    });
    await expect(rcon.postResults({ m: 'measure' })).rejects.toThrow(
      'test err'
    );
  });

  it('#endTrial throws if no results have been posted', async () => {
    const { rcon } = makeRCon({ trial: 0, block: 1 });
    await expect(rcon.endTrial()).rejects.toThrow();
  });

  it('#endTrial properly switches to the next trial', async () => {
    const { rcon } = makeRCon({ trial: 0, block: 1 });
    const currentTrial = await rcon.getCurrentTrial();
    const nextTrial = await rcon.getNextTrial();
    expect(currentTrial.number).toBe(0);
    expect(currentTrial.block.number).toBe(1);
    expect(nextTrial.number).toBe(1);
    expect(nextTrial.block.number).toBe(1);
    await rcon.postResults({});
    expect(await rcon.endTrial()).toBe(nextTrial);
    expect(await rcon.getCurrentTrial()).toBe(nextTrial);
  });

  it('#postResults posts the results sequentially', async () => {
    const post = jest.fn().mockName('post');
    const defs = Array.from({ length: 3 }).map(() => deferred());
    defs.forEach(def => post.mockReturnValueOnce(def.promise));
    const { rcon } = makeRCon({ trial: 0, block: 0, post, token: 'token' });
    rcon.postResults({ val: 'val1' });
    await rcon.endTrial();
    rcon.postResults({ val: 'val2' });
    await rcon.endTrial();
    rcon.postResults({ val: 'val3' });
    await rcon.endTrial();
    // Only one call for now as no post as returned yet.
    expect(post).toMatchSnapshot();
    defs[0].resolve();
    await wait();
    // Second call call now.
    expect(post).toMatchSnapshot();
    defs[1].resolve();
    await wait();
    // Third call call now.
    expect(post).toMatchSnapshot();
  });

  it('#endTrial resolves even if postResults is not done', async () => {
    const def = deferred();
    const post = jest.fn(() => def.promise);
    const { rcon } = makeRCon({ post });
    let postDone = false;
    rcon.postResults({ val: 'val1' }).then(() => {
      postDone = true;
    });
    await rcon.endTrial();
    expect(postDone).toBe(false);
  });

  it('#flush is delegated on the queue', async () => {
    const def = deferred();
    const queue = {
      push: spyDelay(),
      flush: jest.fn(() => def.promise)
    };
    const { rcon } = makeRCon({ queue });
    let resolved = false;
    rcon.flush(42).then(() => {
      resolved = true;
    });
    expect(queue.flush).toMatchSnapshot();
    await wait();
    expect(resolved).toBe(false);
    def.resolve();
    await wait();
    expect(resolved).toBe(true);
  });
});
