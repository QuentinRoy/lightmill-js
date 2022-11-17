import * as sax from 'sax';

export type ExperimentBase = {
  author: string;
  description: string;
  id: string;
};
export type Experiment<T extends Task> = ExperimentBase & {
  runs: Run<T>[];
};
export type RunBase = {
  id: string;
};
export type Run<T extends Task> = RunBase & {
  tasks: Array<T>;
};
export type FactorValues = Record<string, unknown>;
export type Trial = (
  | { practice: false; number: number; blockNumber: number }
  | { practice: true }
) &
  FactorValues;
export type Block = ({ practice: false; number: number } | { practice: true }) &
  FactorValues;
export type Task = Record<string, unknown> & { type: string };

type TypeParserKey = 'integer' | 'float' | 'string';
type TypeParser = ((x: string) => number) | ((x: string) => string);
const typeParsers: Record<TypeParserKey, TypeParser> = {
  integer: (x: string) => parseInt(x, 10),
  float: (x: string) => parseFloat(x),
  string: (x: string) => x,
};

type MapperArgs = [Record<string, unknown>, ...Record<string, unknown>[]];
type Mapper<FArgs extends MapperArgs, T extends Task> =
  | string
  | T
  | ((...args: FArgs) => string | T | Array<T>)
  | Array<T | string>;
type DefinedMapper<FArgs extends MapperArgs, T extends Task> =
  | T
  | ((...args: FArgs) => T | Array<T>)
  | Array<T>;

type MapperOptions<T extends Task> = {
  preBlock?: Mapper<[Block, RunBase, ExperimentBase], T>;
  postBlock?: Mapper<[Block, RunBase, ExperimentBase], T>;
  trial?: Mapper<[Trial, Block, RunBase, ExperimentBase], T>;
  preRun?: Mapper<[RunBase, ExperimentBase], T>;
  postRun?: Mapper<[RunBase, ExperimentBase], T>;
};
type DefinedMapperOptions<T extends Task> = {
  preBlock?: DefinedMapper<[Block, RunBase, ExperimentBase], T>;
  postBlock?: DefinedMapper<[Block, RunBase, ExperimentBase], T>;
  trial?: DefinedMapper<[Trial, Block, RunBase, ExperimentBase], T>;
  preRun?: DefinedMapper<[RunBase, ExperimentBase], T>;
  postRun?: DefinedMapper<[RunBase, ExperimentBase], T>;
};

/**
 * @param {String|stream.Readable} touchStoneXML The XML to parse.
 * @param {object} [options] Options
 * @param {string|object|array|function} [options.preBlock] The type of the
 * task to insert before each block or a function to map the block values to
 * task(s).
 * @param {string|object|array|function} [options.postBlock] The type of the
 * task to insert after each block or a function to map the block values to
 * task(s).
 * @param {string|object|array|function} [options.preRun] The type of the task
 * to insert before each run or a function to map the run values to task(s).
 * @param {string|object|array|function} [options.postRun] The type of the task
 * to insert after each run or a function to map the run values to task(s).
 * @param {string|object|array|function} [options.trial=trial] The type of
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
export default function convertTouchstone<T extends Task>(
  touchStoneXML: string | { pipe: (arg0: sax.SAXStream) => void },
  opts: DefinedMapperOptions<T> & Required<Pick<MapperOptions<T>, 'trial'>>
): Promise<Experiment<T>>;
export default function convertTouchstone(
  touchStoneXML: string | { pipe: (arg0: sax.SAXStream) => void },
  opts?: MapperOptions<Task>
): Promise<Experiment<Task>>;
export default function convertTouchstone(
  touchStoneXML: string | { pipe: (arg0: sax.SAXStream) => void },
  {
    preBlock = undefined,
    postBlock = undefined,
    preRun = undefined,
    postRun = undefined,
    trial = 'trial',
  }: MapperOptions<Task> = {}
): Promise<Experiment<Task>> {
  return new Promise((resolve, reject) => {
    const saxParser =
      typeof touchStoneXML === 'string'
        ? sax.parser(true, { lowercase: true })
        : sax.createStream(true, { lowercase: true });

    // Handlers to parse values (initialized using factor types).
    const valueParsers: Record<string, TypeParser> = {};

    const getPreBlockTasks = createTaskGetter(preBlock);
    const getPostBlockTasks = createTaskGetter(postBlock);
    const getPreRunTasks = createTaskGetter(preRun);
    const getPostRunTasks = createTaskGetter(postRun);
    const getTrialTasks = createTaskGetter(trial);

    let experiment: Experiment<Task> | null = null;
    let currentRun: Run<Task> | null = null;
    let currentBlock: Block | null = null;

    // Handlers to be called on open tag events.
    const openHandlers = {
      setup() {
        // Nothing to do.
      },
      value() {
        // Nothing to do.
      },
      intertrial() {
        // Nothing to do.
      },
      factor({ attributes: { id, type } }: sax.Tag) {
        let typeParserKey = type.toLowerCase();
        // Use factor tags to know how to parse task values.
        if (!(typeParserKey in typeParsers)) {
          throw new Error(`Unknown factor type: ${type}`);
        }
        valueParsers[id] = typeParsers[typeParserKey as TypeParserKey];
      },
      experiment({ attributes: { author, description, id } }: sax.Tag) {
        if (experiment != null) {
          throw new Error('There can only be one experiment tag');
        }
        experiment = { author, description, id, runs: [] };
      },
      run({ attributes: { id } }: sax.Tag) {
        if (currentRun != null) throw new Error('Runs cannot be nested');
        if (experiment == null) {
          throw new Error('Blocks must be inside an experiment');
        }
        currentRun = { id, tasks: [] };
        experiment.runs.push(currentRun);
        // This is very protective, but it ensures mappers cannot mess with
        // our internal state.
        let { tasks, ...runBase } = currentRun;
        let { runs, ...experimentBase } = experiment;
        currentRun.tasks = getPreRunTasks(runBase, experimentBase);
      },
      block(blockNode: sax.Tag, practice = false) {
        if (currentBlock != null) throw new Error('Blocks cannot be nested');
        if (currentRun == null) {
          throw new Error('Blocks must be inside runs');
        }
        if (experiment == null) {
          throw new Error('Blocks must be inside experiments');
        }
        currentBlock = {
          ...(blockNode.attributes.values == null
            ? {}
            : parseValues(blockNode.attributes.values, valueParsers)),
          ...(practice
            ? { practice }
            : { practice, number: +blockNode.attributes.number }),
        };
        // This is very protective, but it ensures mappers cannot mess with
        // our internal state.
        let { tasks, ...runBase } = currentRun;
        let { runs, ...experimentBase } = experiment;
        currentRun.tasks.push(
          ...getPreBlockTasks({ ...currentBlock }, runBase, experimentBase)
        );
      },
      practice(practiceNode: sax.Tag) {
        return openHandlers.block(practiceNode, true);
      },
      trial(trialNode: sax.Tag) {
        if (currentRun == null) {
          throw new Error('Trials must be inside runs');
        }
        if (experiment == null) {
          throw new Error('Trials must be inside experiments');
        }
        if (currentBlock == null) {
          throw new Error('Trials must be inside blocks');
        }
        let values =
          trialNode.attributes.values == null
            ? {}
            : parseValues(trialNode.attributes.values, valueParsers);
        let trial: Trial = currentBlock.practice
          ? {
              ...currentBlock,
              ...values,
            }
          : {
              ...currentBlock,
              ...values,
              number: +trialNode.attributes.number,
              blockNumber: currentBlock.number,
            };
        // This is very protective, but it ensures mappers cannot mess with
        // our internal state.
        let { tasks, ...runBase } = currentRun;
        let { runs, ...experimentBase } = experiment;
        currentRun.tasks.push(
          ...getTrialTasks(trial, { ...currentBlock }, runBase, experimentBase)
        );
      },
    };

    // Handlers to be called on tag close events.
    const closeHandlers = {
      setup() {
        // Nothing to do.
      },
      factor() {
        // Nothing to do.
      },
      value() {
        // Nothing to do.
      },
      intertrial() {
        // Nothing to do.
      },
      trial() {
        // Nothing to do.
      },
      experiment() {
        if (experiment == null) {
          throw new Error('There must be an experiment tag');
        }
        if (currentRun != null) {
          throw new Error('Experiment tag closed before run tag');
        }
      },
      run() {
        if (experiment == null) {
          throw new Error('Run tag closed before experiment tag');
        }
        if (currentRun == null) {
          throw new Error('Run tag closed before run tag');
        }
        // This is very protective, but it ensures mappers cannot mess with
        // our internal state.
        let { runs, ...experimentBase } = experiment;
        let { tasks, ...runBase } = currentRun;
        currentRun.tasks.push(...getPostRunTasks(runBase, experimentBase));
        currentRun = null;
        currentBlock = null;
      },
      block() {
        if (currentRun == null) {
          throw new Error('Block tag closed before run tag');
        }
        if (currentBlock == null) {
          throw new Error('Block tag closed before block tag');
        }
        if (experiment == null) {
          throw new Error('Block tag closed before experiment tag');
        }
        // This is very protective, but it ensures mappers cannot mess with
        // our internal state.
        let { runs, ...experimentBase } = experiment;
        let { tasks, ...runBase } = currentRun;
        currentRun.tasks.push(
          ...getPostBlockTasks(currentBlock, runBase, experimentBase)
        );
        currentBlock = null;
      },
      practice() {
        return closeHandlers.block();
      },
    };

    // Attach the handlers to the sax parser.

    const handleCloseTag = (tagName: string) => {
      if (!(tagName in closeHandlers)) {
        throw new Error(`Unknown close handler for tag "${tagName}"`);
      }
      closeHandlers[tagName as keyof typeof closeHandlers]();
    };

    const handleOpenTag = (tag: sax.Tag) => {
      if (!(tag.name in openHandlers)) {
        throw new Error(`Unknown open handler for tag "${tag.name}"`);
      }
      openHandlers[tag.name as keyof typeof openHandlers](tag);
    };
    if (saxParser instanceof sax.SAXStream) {
      saxParser.on('closetag', handleCloseTag);
      saxParser.on('opentag', handleOpenTag);
    } else {
      saxParser.onopentag = handleOpenTag;
      saxParser.onclosetag = handleCloseTag;
    }

    const handleEnd = () => {
      if (experiment == null) {
        reject(new Error('No experiment tag found'));
      } else {
        resolve(experiment);
      }
    };

    if (
      saxParser instanceof sax.SAXParser &&
      typeof touchStoneXML === 'string'
    ) {
      saxParser.onerror = reject;
      saxParser.onend = handleEnd;
      saxParser.write(touchStoneXML);
      saxParser.close();
    } else if (
      saxParser instanceof sax.SAXStream &&
      typeof touchStoneXML == 'object' &&
      'pipe' in touchStoneXML
    ) {
      saxParser.on('error', reject);
      saxParser.on('end', handleEnd);
      touchStoneXML.pipe(saxParser);
    } else {
      throw new Error('Invalid arguments');
    }
  });
}

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
function parseValues<K extends string, P extends (value: string) => unknown>(
  valuesString: string,
  valueParsers?: Record<K, P>
): Record<string, string | ReturnType<P>> {
  let values: Record<string, string | ReturnType<P>> = {};
  for (let value of valuesString.split(',')) {
    let [name, valueString] = value.split('=');
    if (valueParsers != null && name in valueParsers) {
      let parser = valueParsers[name as K];
      values[name] = parser(valueString) as ReturnType<P>;
    } else {
      values[name] = valueString;
    }
  }
  return values;
}

function createTaskGetter<FArgs extends MapperArgs, T extends Task>(
  mapper?: DefinedMapper<FArgs, T>
): (...args: FArgs) => Array<T>;
function createTaskGetter<FArgs extends MapperArgs, T extends Task>(
  mapper?: Mapper<FArgs, T>
): (...args: FArgs) => Array<Task>;
function createTaskGetter<FArgs extends MapperArgs, T extends Task>(
  mapper?: Mapper<FArgs, T>
): (...args: FArgs) => Array<Task> {
  if (mapper == null) {
    return () => [];
  }
  if (typeof mapper === 'string' || mapper instanceof String) {
    return (
      container: Record<string, unknown>,
      // The rest argument must be included for typescript to be happy.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ...rest: Record<string, unknown>[]
    ) => [{ ...container, type: mapper as string }];
  }
  if (typeof mapper === 'function') {
    return (...args: FArgs) => {
      let value = mapper(...args);
      let getter = createTaskGetter(value);
      return getter(args[0], ...args.slice(1));
    };
  }
  if (Array.isArray(mapper)) {
    const getters = mapper.map(createTaskGetter);
    return (...args) => {
      let result: Array<Task> = [];
      for (let i = 0; i < getters.length; i++) {
        result.push(...getters[i](args[0], ...args.slice(1)));
      }
      return result;
    };
  }
  return () => [mapper];
}
