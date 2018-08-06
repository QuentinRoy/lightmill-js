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
        ...valuesString.split(',').map(valueString => {
          const [valName, val] = valueString.split('=');
          return {
            [valName]:
              valName in valueParsers ? valueParsers[valName](val) : val
          };
        })
      )
    : {};

const typeParsers = {
  integer: x => parseInt(x, 10),
  float: x => parseFloat(x),
  string: x => x
};

/**
 * @param {String|stream.Readable} touchStoneXML The XML to parse.
 * @param {object} [options] Options
 * @param {string} [options.blockStartupTask='block-startup'] The type of the
 * task to insert at each block startup. Set to null to disable block startup
 * tasks.
 * @param {string} [options.trialTask='trial'] The type of trial's task.
 * @return {Promise<object>} The experimental design converted into a format
 * supported by @lightmill/static-design.
 */
const convertTouchstone = (
  touchStoneXML,
  { blockStartupType = 'block-startup', trialType = 'trial' } = {}
) =>
  new Promise((resolve, reject) => {
    const saxParser =
      typeof touchStoneXML === 'string'
        ? sax.parser(true, { lowercase: true })
        : sax.createStream(true, { lowercase: true });
    // Handlers to parse values (initialized using factor types).
    const valueParsers = {};

    let experiment;
    let currentRun;
    let currentBlock;

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
        experiment = { author, description, id, runs: [] };
      },
      run({ attributes: { id } }) {
        if (currentRun) throw new Error('Runs cannot be nested');
        currentRun = { id, tasks: [] };
        experiment.runs.push(currentRun);
      },
      block(blockNode, practice = false) {
        if (currentBlock) throw new Error('Blocks cannot be nested');
        currentBlock = {
          practice,
          ...parseValues(blockNode.attributes.values, valueParsers),
          ...(practice ? {} : { number: +blockNode.attributes.number })
        };
        if (blockStartupType) {
          currentRun.tasks.push({ type: blockStartupType, ...currentBlock });
        }
      },
      practice(practiceNode) {
        return openHandlers.block(practiceNode, true);
      },
      trial(trialNode) {
        currentRun.tasks.push({
          ...currentBlock,
          type: trialType,
          ...(currentBlock.practice
            ? {}
            : {
                number: +trialNode.attributes.number,
                blockNumber: +currentBlock.number
              }),
          ...parseValues(trialNode.attributes.values, valueParsers)
        });
      }
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
        resolve(experiment);
      },
      run() {
        currentRun = null;
      },
      block() {
        currentBlock = null;
      },
      practice(...args) {
        return closeHandlers.block(...args);
      }
    };

    // Attach the handlers to the sax parser.
    [
      { event: 'opentag', handlers: openHandlers, handlerMap: x => x.name },
      { event: 'closetag', handlers: closeHandlers, handlerMap: x => x }
    ].forEach(({ event, handlers, handlerMap }) => {
      saxParser[`on${event}`] = x => {
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
