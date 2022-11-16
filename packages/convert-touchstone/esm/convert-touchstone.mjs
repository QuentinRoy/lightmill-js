import sax from 'sax';

/**
 * Parse the values string (as encoded by touchstone).
 * @param {string} valuesString The values encoded in a string.
 * E.g. "val1=foo,val2=bar".
 * @param {object} valueParsers Handlers to transform values based on their
 * name. E.g. { val1: x => +x } can be used to map val1 to numbers.
 * @return {object} An object whose keys are the name of the values, and values
 * the values.
 * @private
 */
const parseValues = (valuesString, valueParsers = {}) =>
  valuesString
    ? Object.assign(
        ...valuesString.split(',').map((valueString) => {
          const [valName, val] = valueString.split('=');
          return {
            [valName]:
              valName in valueParsers ? valueParsers[valName](val) : val,
          };
        })
      )
    : {};

const typeParsers = {
  integer: (x) => parseInt(x, 10),
  float: (x) => parseFloat(x),
  string: (x) => x,
};

const createTaskGetter = (mapper) => {
  if (!mapper) {
    return () => [];
  }
  if (typeof mapper === 'string' || mapper instanceof String) {
    return (container) => [{ ...container, type: mapper }];
  }
  if (typeof mapper === 'function') {
    return (...args) => createTaskGetter(mapper(...args))(...args);
  }
  if (Array.isArray(mapper)) {
    const getters = mapper.map(createTaskGetter);
    return (...args) =>
      getters.reduce((acc, getter) => [...acc, ...getter(...args)], []);
  }
  return () => [mapper];
};

/**
 * @param {String|stream.Readable} touchStoneXML The XML to parse.
 * @param {object} [options] Options
 * @param {string|object|array|function} [options.preBlocks] The type of the
 * task to insert before each block or a function to map the block values to
 * task(s).
 * @param {string|object|array|function} [options.postBlocks] The type of the
 * task to insert after each block or a function to map the block values to
 * task(s).
 * @param {string|object|array|function} [options.preRuns] The type of the task
 * to insert before each run or a function to map the run values to task(s).
 * @param {string|object|array|function} [options.postRuns] The type of the task
 * to insert after each run or a function to map the run values to task(s).
 * @param {string|object|array|function} [options.trials=trial] The type of
 * the task to insert for each trial or a function to map the trial values
 * to task(s).
 * @return {Promise<object>} The experimental design converted into a format
 * supported by @lightmill/static-design.
 *
 * @example
 * // Map each run to a task to insert before the trials of the run.
 * const preRuns = (run, experiment) => ({
 *   ...run,
 *   type: 'pre-run'
 * });
 * // Mappers can also be strings...
 * const postRuns = 'post-run';  // This is the same as above.
 * // ...arrays (if several tasks need to be inserted)...
 * const preBlocks = [
 *   { type: 'pre-block-1' },
 *   { type: 'pre-block-2' }
 * ];
 * // ...or functions that returns arrays.
 * const postBlocks = (block, run, experiment) => [
 *   { type: 'post-block-1', runId: run.id },
 *   { ...block , type: 'post-block-2' }
 *   'post-block-2' // This is the same as above.
 * ];
 * convertTouchStone(data, { preBlocks, postBlocks, postRuns, preRuns })
 *   .then(doSomething);
 */
const convertTouchstone = (
  touchStoneXML,
  {
    preBlocks = undefined,
    postBlocks = undefined,
    preRuns = undefined,
    postRuns = undefined,
    trials = 'trial',
  } = {}
) =>
  new Promise((resolve, reject) => {
    const saxParser =
      typeof touchStoneXML === 'string'
        ? sax.parser(true, { lowercase: true })
        : sax.createStream(true, { lowercase: true });
    // Handlers to parse values (initialized using factor types).
    const valueParsers = {};

    const getPreBlockTasks = createTaskGetter(preBlocks);
    const getPostBlockTasks = createTaskGetter(postBlocks);
    const getPreRunTasks = createTaskGetter(preRuns);
    const getPostRunTasks = createTaskGetter(postRuns);
    const getTrialTasks = createTaskGetter(trials);

    let runs = null;
    let experiment = null;
    let currentRun = null;
    let currentTasks = null;
    let currentBlock = null;

    // Handlers to be called on open tag events.
    const openHandlers = {
      setup() {},
      value() {},
      intertrial() {},
      factor({ attributes: { id, type } }) {
        // Use factor tags to know how to parse task values.
        valueParsers[id] = typeParsers[type.toLowerCase()];
      },
      experiment({ attributes: { author, description, id } }) {
        if (experiment) throw new Error('There can only be one experiment tag');
        experiment = { author, description, id };
        runs = [];
      },
      run({ attributes: { id } }) {
        if (currentRun) throw new Error('Runs cannot be nested');
        currentRun = { id };
        currentTasks = getPreRunTasks(currentRun, experiment);
      },
      block(blockNode, practice = false) {
        if (currentBlock) throw new Error('Blocks cannot be nested');
        currentBlock = {
          practice,
          ...parseValues(blockNode.attributes.values, valueParsers),
          ...(practice ? {} : { number: +blockNode.attributes.number }),
        };
        currentTasks.push(
          ...getPreBlockTasks(currentBlock, currentRun, experiment)
        );
      },
      practice(practiceNode) {
        return openHandlers.block(practiceNode, true);
      },
      trial(trialNode) {
        const trial = {
          ...currentBlock,
          ...(currentBlock.practice
            ? {}
            : {
                number: +trialNode.attributes.number,
                blockNumber: +currentBlock.number,
              }),
          ...parseValues(trialNode.attributes.values, valueParsers),
        };
        currentTasks.push(...getTrialTasks(trial));
      },
    };

    // Handlers to be called on tag close events.
    const closeHandlers = {
      setup() {},
      factor() {},
      value() {},
      intertrial() {},
      trial() {},
      experiment() {
        if (currentRun) throw new Error('Experiment tag closed before run tag');
        resolve({ ...experiment, runs });
        experiment = null;
        runs = null;
        currentTasks = null;
        currentBlock = null;
      },
      run() {
        currentTasks.push(...getPostRunTasks(currentRun, experiment));
        runs.push({ ...currentRun, tasks: currentTasks });
        currentRun = null;
        currentBlock = null;
        currentTasks = null;
      },
      block() {
        currentTasks.push(
          ...getPostBlockTasks(currentBlock, currentRun, experiment)
        );
        currentBlock = null;
      },
      practice(...args) {
        return closeHandlers.block(...args);
      },
    };

    // Attach the handlers to the sax parser.
    [
      { event: 'opentag', handlers: openHandlers, handlerMap: (x) => x.name },
      { event: 'closetag', handlers: closeHandlers, handlerMap: (x) => x },
    ].forEach(({ event, handlers, handlerMap }) => {
      saxParser[`on${event}`] = (x) => {
        const handlerName = handlerMap(x);
        const handler = handlers[handlerName];
        if (!handler) {
          throw new Error(
            `Unknown handler for event "${event}": "${handlerName}"`
          );
        }
        handler(x);
      };
    });

    saxParser.onerror = reject;

    if (typeof touchStoneXML === 'string') {
      saxParser.write(touchStoneXML);
    } else {
      touchStoneXML.pipe(saxParser);
    }
  });

export default convertTouchstone;
