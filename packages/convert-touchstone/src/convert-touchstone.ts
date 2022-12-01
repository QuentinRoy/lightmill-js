import * as sax from 'sax';
import type StaticDesign from '@lightmill/static-design';

export type ExperimentBase = {
  author: string;
  description: string;
  id: string;
};
export type RunBase = { id: string };
export type Run<T extends BaseTask> = RunBase & {
  tasks: Array<T>;
};
export type Trial = (
  | { practice: false; number: number; blockNumber: number }
  | { practice: true }
) &
  FactorValues;
export type Block = ({ practice: false; number: number } | { practice: true }) &
  FactorValues;
export type FactorValues = Record<string, unknown>;
export type BaseTask = { type: string; id: string };
export type UndefinedTask = BaseTask & Record<string, unknown>;
export type DesignConfig<T extends BaseTask> = ExperimentBase &
  ConstructorParameters<typeof StaticDesign<T>>[0];

type TypeParserKey = 'integer' | 'float' | 'string';
type TypeParser = ((x: string) => number) | ((x: string) => string);
const typeParsers: Record<TypeParserKey, TypeParser> = {
  integer: (x: string) => parseInt(x, 10),
  float: (x: string) => parseFloat(x),
  string: (x: string) => x,
};
type FacultativeId<T> = Omit<T, 'id'> & { id?: string };

type MapperArgs = [Record<string, unknown>, ...Record<string, unknown>[]];
type Mapper<FArgs extends MapperArgs, T> =
  | string
  | T
  | Array<string | T>
  | ((...args: FArgs) => string | T | Array<string | T>);
type DefinedMapper<FArgs extends MapperArgs, T> =
  | ((...args: FArgs) => T | Array<T>)
  | T
  | Array<T>;
type MapperOptions<T> = {
  preBlock?: Mapper<[Block, RunBase, ExperimentBase], T>;
  postBlock?: Mapper<[Block, RunBase, ExperimentBase], T>;
  trial?: Mapper<[Trial, Block, RunBase, ExperimentBase], T>;
  preRun?: Mapper<[RunBase, ExperimentBase], T>;
  postRun?: Mapper<[RunBase, ExperimentBase], T>;
};
type DefinedMapperOptions<T> = {
  preBlock?: DefinedMapper<[Block, RunBase, ExperimentBase], T>;
  postBlock?: DefinedMapper<[Block, RunBase, ExperimentBase], T>;
  trial?: DefinedMapper<[Trial, Block, RunBase, ExperimentBase], T>;
  preRun?: DefinedMapper<[RunBase, ExperimentBase], T>;
  postRun?: DefinedMapper<[RunBase, ExperimentBase], T>;
};

/**
 * @param touchStoneXML The XML to parse.
 * @param [options] Options
 * @return The experimental design converted into a format
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
 * // ...arrays of string (if several tasks need to be inserted)...
 * const preBlocks = [
 *   'pre-block-1',
 *   'pre-block-2',
 * ];
 * // ...or functions that returns Task or array of Tasks.
 * const postBlocks = (block, run, experiment) => [
 *   { type: 'post-block-1', runId: run.id, id: getId(block, run, experiment) },
 *   { ...block , type: 'post-block-2', id: getId(block, run, experiment) }
 * ];
 * convertTouchStone(data, { preBlocks, postBlocks, postRuns, preRuns })
 *   .then(doSomething);
 */
export default function convertTouchstone<T extends BaseTask>(
  touchStoneXML: string | { pipe: (arg0: sax.SAXStream) => void },
  opts: DefinedMapperOptions<FacultativeId<T>> &
    Required<Pick<DefinedMapperOptions<FacultativeId<T>>, 'trial'>>
): Promise<DesignConfig<T>>;
export default function convertTouchstone(
  touchStoneXML: string | { pipe: (arg0: sax.SAXStream) => void },
  opts?: MapperOptions<FacultativeId<UndefinedTask>>
): Promise<DesignConfig<UndefinedTask>>;
export default function convertTouchstone(
  touchStoneXML: string | { pipe: (arg0: sax.SAXStream) => void },
  {
    preBlock = undefined,
    postBlock = undefined,
    preRun = undefined,
    postRun = undefined,
    trial = createDefaultTrialMapper(),
  }: MapperOptions<FacultativeId<UndefinedTask>> = {}
): Promise<DesignConfig<UndefinedTask>> {
  return new Promise((resolve, reject) => {
    const saxParser =
      typeof touchStoneXML === 'string'
        ? sax.parser(true, { lowercase: true })
        : sax.createStream(true, { lowercase: true });

    // Handlers to parse values (initialized using factor types).
    const valueParsers: Record<string, TypeParser> = {};

    const taskIdManager = new IdManager();
    const getTaskId = (type: string, requestedId?: string) => {
      if (requestedId == null) {
        return taskIdManager.makeNew(type);
      } else {
        taskIdManager.add(requestedId);
        return requestedId;
      }
    };

    const getPreBlockTasks = createTaskGetter(preBlock, getTaskId);
    const getPostBlockTasks = createTaskGetter(postBlock, getTaskId);
    const getPreRunTasks = createTaskGetter(preRun, getTaskId);
    const getPostRunTasks = createTaskGetter(postRun, getTaskId);
    const getTrialTasks = createTaskGetter(trial, getTaskId);

    let experiment: DesignConfig<BaseTask> | null = null;
    let currentRun: Run<BaseTask> | null = null;
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
        experiment = { author, description, id, timelines: [] };
      },
      run({ attributes: { id } }: sax.Tag) {
        if (currentRun != null) throw new Error('Runs cannot be nested');
        if (experiment == null) {
          throw new Error('Blocks must be inside an experiment');
        }
        currentRun = { id, tasks: [] };
        experiment.timelines.push(currentRun);
        // This is very protective, but it ensures mappers cannot mess with
        // our internal state.
        let { tasks, ...runBase } = currentRun;
        let { timelines, ...experimentBase } = experiment;
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
        let { timelines, ...experimentBase } = experiment;
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
        let { timelines, ...experimentBase } = experiment;
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
        let { timelines, ...experimentBase } = experiment;
        let { tasks, ...runBase } = currentRun;
        currentRun.tasks.push(...getPostRunTasks(runBase, experimentBase));
        currentRun = null;
        currentBlock = null;
        taskIdManager.reset();
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
        let { timelines, ...experimentBase } = experiment;
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

class IdManager {
  #lastIdNumbers = new Map<string, number>();
  #ids = new Set<string>();

  makeNew(type: string) {
    let idNumber = this.#lastIdNumbers.get(type) || 0;
    this.#lastIdNumbers.set(type, idNumber + 1);
    let id = `${type}-${idNumber}`;
    this.add(id);
    return id;
  }

  add(id: string) {
    if (this.#ids.has(id)) {
      throw new Error(`Duplicate id "${id}"`);
    }
    this.#ids.add(id);
  }

  reset() {
    this.#lastIdNumbers.clear();
    this.#ids.clear();
  }
}

function createTaskGetter<FArgs extends MapperArgs, T extends BaseTask>(
  mapper: DefinedMapper<FArgs, FacultativeId<T>> | undefined,
  getId: (type: string, requestedId?: string) => string
): (...args: FArgs) => Array<T>;
function createTaskGetter<FArgs extends MapperArgs, T extends BaseTask>(
  mapper: Mapper<FArgs, FacultativeId<T>> | undefined,
  getId: (type: string, requestedId?: string) => string
): (...args: FArgs) => Array<BaseTask>;
function createTaskGetter<FArgs extends MapperArgs, T extends BaseTask>(
  mapper: Mapper<FArgs, FacultativeId<T>> | undefined,
  getId: (type: string, requestedId?: string) => string
): (...args: FArgs) => Array<BaseTask> {
  if (mapper == null) {
    return () => [];
  }
  if (typeof mapper !== 'function') {
    let innerValue = mapper;
    mapper = () => innerValue;
  }
  let getValue = mapper;
  return (...args: FArgs) => {
    let value = getValue(...args);
    if (!Array.isArray(value)) {
      value = [value];
    }
    return value.map((task) => {
      if (typeof task === 'string') {
        return {
          ...args[0],
          type: task,
          id: getId(task, undefined),
        };
      }
      let requestedId: string | undefined = undefined;
      if ('id' in task) {
        if (typeof task.id !== 'string') {
          throw new Error('Cannot use id in mapper if it is not a string');
        }
        requestedId = task.id;
      }
      return { ...task, id: getId(task.type, requestedId) };
    });
  };
}

function createDefaultTrialMapper() {
  let lastPracticeTrialId = 0;
  return function (trial: Trial, block: Block): BaseTask {
    let id: string;
    if (trial.practice || block.practice) {
      lastPracticeTrialId += 1;
      id = `practice-trial-${lastPracticeTrialId}`;
    } else {
      id = `trial-${block.number}-${trial.number}`;
    }
    return { ...trial, type: 'trial', id };
  };
}
