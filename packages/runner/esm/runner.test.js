import runner from './runner';

const wait = t =>
  new Promise(resolve => {
    setTimeout(resolve, t);
  });

describe('Runner#start', () => {
  let genTasks;
  let taskManager;
  let logger;

  beforeEach(() => {
    // i is used to make sure all functions are called in the right order,
    // and wait for each others.
    let i = -1;
    const getCallNb = () => {
      i += 1;
      return i;
    };
    genTasks = jest.fn(async function* mockGenTasks() {
      await wait(0);
      yield { id: 'task1', i: getCallNb() };
      await wait(0);
      yield { id: 'task2', i: getCallNb() };
      await wait(0);
      yield { id: 'task3', i: getCallNb() };
      await wait(0);
    });
    taskManager = jest.fn(async task => {
      await wait(0);
      return { result: `result-${task.id}`, i: getCallNb() };
    });
    logger = {
      log: jest.fn(async () => {
        await wait(0);
        return { i: getCallNb() };
      }),
      complete: jest.fn(async () => {
        await wait(0);
        return { i: getCallNb() };
      })
    };
  });

  it('calls the taskManager for each tasks, and log the result', async () => {
    await runner({
      taskIterator: genTasks(),
      store: logger,
      taskManager
    }).start();
    expect(taskManager).toMatchSnapshot();
    expect(logger.log).toMatchSnapshot();
    expect(logger.complete).toMatchSnapshot();
  });
});
