# @lightmill/convert-touchstone

Turn an experiment design made with the original [Touchstone design platform](https://github.com/jdfekete/touchstone-platforms/tree/master/design-platform) into LightMill timelines, one per run.

Touchstone is a tool to design experiments: their factors, blocks, trials, and the counterbalanced order of each participant. It exports them as XML. This package converts that Touchstone 1 XML into timelines that [`@lightmill/react-experiment`](../react-experiment/README.md) or [`@lightmill/runner`](../runner/README.md) can play. Designs from [Touchstone 2](https://touchstone2.org) use another format, which it doesn't support yet. If you don't use Touchstone, write your timelines in code instead, with [`@lightmill/counterbalancing`](../counterbalancing/README.md) to order conditions.

## Convert a design

Converting a design is usually a one-off step, so run the command with `npx`, without installing anything. It needs Node.js 24.12 or later.

```sh
npx @lightmill/convert-touchstone design.xml > design.json
```

The command writes the design as JSON on the standard output:

```ts
{
  id: string;
  author: string;
  description: string;
  runs: Array<{ id: string; timeline: Task[] }>;
}
```

Each run is one participant's sequence: Touchstone names them `S0`, `S1`, and so on. Import the file in your app and pick the run for each participant, then use the run id as the run name on the log server:

```ts
import design from './design.json';

const run = design.runs.find((run) => run.id === `S${participantNumber}`);
```

Options insert tasks around runs and blocks, or change the type of trial tasks:

| Option                | Effect                                         |
| --------------------- | ---------------------------------------------- |
| `--trials`, `-t`      | Sets the type of trial tasks.                  |
| `--pre-runs`, `-r`    | Inserts a task of this type before each run.   |
| `--post-runs`, `-n`   | Inserts a task of this type after each run.    |
| `--pre-blocks`, `-b`  | Inserts a task of this type before each block. |
| `--post-blocks`, `-k` | Inserts a task of this type after each block.  |

```sh
npx @lightmill/convert-touchstone design.xml --pre-runs instructions --pre-blocks block-start > design.json
```

An inserted block task gets the block's factor values, and whether it is a practice block. For more control over the tasks, use the [JavaScript API](#javascript-api).

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

Every task gets an `id`, unique within its run:

- default trial tasks get `trial-<blockNumber>-<number>`, and practice ones `practice-trial-<n>`, counting from 1 in each run;
- other tasks, including trials with a type set by `--trials`, get `<type>-<n>`, counting from 0 for each type in each run.

## Encoding

Touchstone exports XML in ISO-8859-1, but the converter reads files as UTF-8, so accented characters come out wrong. Convert the file to UTF-8 first, for example with `iconv -f ISO-8859-1 -t UTF-8 design.xml > design-utf8.xml`, or pass a decoded string to the JavaScript API.

## JavaScript API

Use the API to build tasks with functions, or to convert designs in your own scripts:

```sh
npm install @lightmill/convert-touchstone
```

```ts
import convertTouchstone from '@lightmill/convert-touchstone';
import { readFile } from 'node:fs/promises';

const xml = new TextDecoder('iso-8859-1').decode(await readFile('design.xml'));
const design = await convertTouchstone(xml, {
  preRun: 'instructions',
  preBlock: (block) => ({ type: 'block-start', practice: block.practice }),
  postBlock: [{ type: 'questionnaire' }, 'break'],
  trial: (trial) => ({ ...trial, type: 'pointing' }),
});
```

`convertTouchstone(xml, options?)` takes the XML as a string or a Node.js readable stream, and resolves with the design. A stream is decoded as UTF-8, whatever the file's encoding.

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

A task object can set its own `id`. An id given twice in the same run throws.

The design's tasks have a `type`, an `id`, and `unknown` other properties. When you pass a `trial` function, the tasks get the type it returns, along with the types of the other options.
