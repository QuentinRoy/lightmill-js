import runner from './runner.mjs';

const wait = t =>
  new Promise(resolve => {
    setTimeout(resolve, t);
  });

describe('Runner#start', () => {
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
      getLogger: jest.fn(
        taskType => (taskType === 'task' ? taskLogger : undefined)
      ),
      complete: jest.fn(async () => {
        await wait(0);
        return { callIndex: getCallIndex() };
      })
    };
  });

  it('calls the taskManager for each tasks, and log the result', async () => {
    await runner({
      taskIterator: genTasks(),
      store,
      runTask
    }).run();
    expect(runTask.mock.calls).toEqual([
      [{ id: 'task1', callIndex: 0 }],
      [{ id: 'task2', callIndex: 3 }],
      [{ id: 'task3', callIndex: 6 }]
    ]);
    expect(taskLogger.log.mock.calls).toEqual([
      [
        'task1',
        {
          task: { id: 'task1', callIndex: 0 },
          measures: { result: 'result-task1', callIndex: 1 }
        }
      ],
      // call 2 should correspond to the above call to logTask
      [
        'task2',
        {
          task: { id: 'task2', callIndex: 3 },
          measures: { result: 'result-task2', callIndex: 4 }
        }
      ],
      // call 5 should correspond to the above call to logTask
      [
        'task3',
        {
          task: { id: 'task3', callIndex: 6 },
          measures: { result: 'result-task3', callIndex: 7 }
        }
      ]
      // call 6 should correspond to the above call to logTask
    ]);
    expect(store.complete.mock.results[0].value).resolves.toEqual({
      callIndex: 9
    });
  });
});
