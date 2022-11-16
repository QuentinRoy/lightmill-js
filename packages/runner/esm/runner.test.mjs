import Runner from './runner.mjs';

const wait = t =>
  new Promise(resolve => {
    setTimeout(resolve, t);
  });

describe('Runner#run', () => {
  let genTasks;
  let runTask;
  let store;
  let taskLogger;

  beforeEach(() => {
    // i is used to make sure all functions are called in the right order,
    // and wait for each others.
    let callIndex = -1;
    const getCallIndex = () => {
      callIndex += 1;
      return callIndex;
    };
    genTasks = jest.fn(async function* mockGenTasks() {
      await wait(0);
      yield { id: 'task1', callIndex: getCallIndex() };
      await wait(0);
      yield { id: 'task2', callIndex: getCallIndex() };
      await wait(0);
      yield { id: 'task3', callIndex: getCallIndex() };
      await wait(0);
    });
    runTask = jest.fn(async task => {
      await wait(0);
      return { result: `result-${task.id}`, callIndex: getCallIndex() };
    });
    taskLogger = {
      log: jest.fn(async () => {
        await wait(0);
        return { callIndex: getCallIndex() };
      })
    };
    store = {
      getLogger: jest.fn(taskType =>
        taskType === 'task' ? taskLogger : undefined
      ),
      complete: jest.fn(async () => {
        await wait(0);
        return { callIndex: getCallIndex() };
      })
    };
  });

  it('calls the taskManager for each tasks, and log the result', async () => {
    await expect(
      Runner({ taskIterator: genTasks(), store, runTask }).run()
    ).resolves.toBe(undefined);
    expect(runTask.mock.calls).toEqual([
      [{ id: 'task1', callIndex: 0 }],
      [{ id: 'task2', callIndex: 3 }],
      [{ id: 'task3', callIndex: 6 }]
    ]);
    expect(taskLogger.log.mock.calls).toEqual([
      [
        {
          task: { id: 'task1', callIndex: 0 },
          measures: { result: 'result-task1', callIndex: 1 }
        },
        { id: 'task1' }
      ],
      // call 2 should correspond to the above call to logTask
      [
        {
          task: { id: 'task2', callIndex: 3 },
          measures: { result: 'result-task2', callIndex: 4 }
        },
        { id: 'task2' }
      ],
      // call 5 should correspond to the above call to logTask
      [
        {
          task: { id: 'task3', callIndex: 6 },
          measures: { result: 'result-task3', callIndex: 7 }
        },
        { id: 'task3' }
      ]
      // call 6 should correspond to the above call to logTask
    ]);
    expect(store.complete.mock.results[0].value).resolves.toEqual({
      callIndex: 9
    });
  });

  it('rejects if the taskManager rejects', async () => {
    const throwingRunTask = jest.fn(async task => {
      if (task.id === 'task2') throw new Error('mock error');
      return `result-${task.id}`;
    });
    await expect(
      Runner({
        store,
        runTask: throwingRunTask,
        taskIterator: genTasks()
      }).run()
    ).rejects.toThrow('mock error');
    expect(throwingRunTask).toMatchSnapshot('throwing run task');
    expect(taskLogger).toMatchSnapshot('task logger');
  });

  it('rejects if the logger rejects', async () => {
    taskLogger = {
      log: jest.fn(async ({ task }) => {
        if (task.id === 'task2') throw new Error('mock error');
      })
    };
    await expect(
      Runner({ store, runTask, taskIterator: genTasks() }).run()
    ).rejects.toThrow('mock error');
    expect(runTask).toMatchSnapshot('throwing logger');
    expect(taskLogger).toMatchSnapshot('task logger');
  });

  it('rejects if the taskIterator rejects', async () => {
    genTasks = jest.fn(async function* mockGenTasks() {
      await wait(0);
      yield { id: 'task1' };
      await wait(0);
      yield { id: 'task2' };
      throw new Error('mock error');
    });
    await expect(
      Runner({ store, runTask, taskIterator: genTasks() }).run()
    ).rejects.toThrow('mock error');
    expect(runTask).toMatchSnapshot('throwing task iterator');
    expect(taskLogger).toMatchSnapshot('task logger');
  });
});
