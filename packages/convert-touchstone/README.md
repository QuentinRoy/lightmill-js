# @lightmill/convert-touchstone

Turn an experiment design made with the [Touchstone design platform](https://github.com/jdfekete/touchstone-platforms/tree/master/design-platform) into LightMill timelines, one per run.

Touchstone is a tool to design experiments: their factors, blocks, trials, and the counterbalanced order of each participant. It exports them as XML. This package converts that XML into timelines that [`@lightmill/react-experiment`](../react-experiment/README.md) or [`@lightmill/runner`](../runner/README.md) can play. If you don't use Touchstone, write your timelines in code instead, with [`@lightmill/counterbalancing`](../counterbalancing/README.md) to order conditions.

## Install

```sh
npm install @lightmill/convert-touchstone
```

It needs Node.js 24.12 or later.

## Command line

```sh
npx @lightmill/convert-touchstone design.xml > design.json
```

| Option                | Inserts                                |
| --------------------- | -------------------------------------- |
| `--trials`, `-t`      | Sets the type of trial tasks.          |
| `--pre-runs`, `-r`    | A task of this type before each run.   |
| `--post-runs`, `-n`   | A task of this type after each run.    |
| `--pre-blocks`, `-b`  | A task of this type before each block. |
| `--post-blocks`, `-k` | A task of this type after each block.  |

The design is written as JSON on the standard output.

## JavaScript

```ts
import convertTouchstone from '@lightmill/convert-touchstone';

const design = await convertTouchstone(xml, {
  preRun: 'instructions',
  preBlock: 'block-start',
});

const timeline = design.runs.find((run) => run.id === 'S3')?.timeline;
```

`xml` is the XML as a string, or a Node.js readable stream. The result is the design:

```ts
{
  id: string;
  author: string;
  description: string;
  runs: Array<{ id: string; timeline: Task[] }>;
}
```

Each run is one participant's sequence: Touchstone names them `S0`, `S1`, and so on. Pick the run for a participant from their number, and use the run id as the run name on the log server.

## Tasks

By default, each trial becomes a task of type `trial` with:

- `practice`: whether the trial is in a practice block;
- `number` and `blockNumber`: the trial's number in its block and the block's number, for trials outside practice blocks;
- one property per factor, with the value of the trial or of its block, parsed as a number for integer and float factors.

```json
{
  "type": "trial",
  "id": "trial-1-0",
  "practice": false,
  "number": 0,
  "blockNumber": 1,
  "factorInt": 2,
  "factorFloat": 0.5,
  "factorString": "foo"
}
```

The options insert tasks around runs and blocks, and change how trials become tasks:

| Option      | Called with                       | Inserts                   |
| ----------- | --------------------------------- | ------------------------- |
| `preRun`    | `(run, experiment)`               | Tasks before each run.    |
| `postRun`   | `(run, experiment)`               | Tasks after each run.     |
| `preBlock`  | `(block, run, experiment)`        | Tasks before each block.  |
| `postBlock` | `(block, run, experiment)`        | Tasks after each block.   |
| `trial`     | `(trial, block, run, experiment)` | The tasks for each trial. |

Each option is one of:

- a function, called with the arguments above, that returns one of the values below;
- a task object, which needs a `type`;
- a string, the type of a task that also gets every property of the first argument: the block's factor values for `preBlock`, the trial's for `trial`;
- an array of strings and task objects, to insert several tasks.

```ts
const design = await convertTouchstone(xml, {
  preRun: 'instructions',
  preBlock: (block) => ({ type: 'block-start', practice: block.practice }),
  postBlock: [{ type: 'questionnaire' }, 'break'],
  trial: (trial) => ({ ...trial, type: 'pointing' }),
});
```

## Task ids

Every task gets an `id`, unique within its run, unless it already has one:

- default trial tasks get `trial-<blockNumber>-<number>`, and practice ones `practice-trial-<n>`, counting from 1 in each run;
- other tasks get `<type>-<n>`, counting from 0 for each type in each run.

An id given twice in the same run throws.

## Encoding

Touchstone exports XML in ISO-8859-1. Streams are always decoded as UTF-8, so accented characters come out wrong. To keep them, read the file yourself and pass a string:

```ts
import { readFile } from 'node:fs/promises';

const xml = new TextDecoder('iso-8859-1').decode(await readFile('design.xml'));
const design = await convertTouchstone(xml);
```

The command line reads files as streams, so it has the same limit.

## TypeScript

The design's tasks have a `type`, an `id`, and `unknown` other properties. When you pass a `trial` function, the tasks get the type it returns, along with the types of the other options.
