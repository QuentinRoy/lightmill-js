# @lightmill/convert-touchstone

Convert a TouchStone XML design file into a Lightmill static design object.

This package is useful when your experiment design is authored in TouchStone and
you want to execute it with Lightmill packages such as
[@lightmill/static-design](../static-design) and [@lightmill/runner](../runner).

## Install

```sh
npm install @lightmill/convert-touchstone
```

You can also run it without installing through `npx`.

### Direct download

Download the latest version, then in your HTML file:

```html
<script src="lightmill-convert-touchstone.js"></script>
```

The library will be injected in `lightmill.convertTouchstone`.

## Usage

### CLI

```sh
lightmill-convert-touchstone <input-file>
```

or:

```sh
npx @lightmill/convert-touchstone <input-file>
```

### JavaScript API

```ts
import convertTouchstone from '@lightmill/convert-touchstone';

const design = await convertTouchstone(xml, {
  preRun: 'pre-run',
  trial: (trial) => ({ ...trial, type: 'trial' }),
});
```

## API Reference

### `convertTouchstone(touchStoneXML, options?)`

Parse TouchStone XML and return a Lightmill static design:

```ts
Promise<{
  id: string;
  author: string;
  description: string;
  runs: Array<{ id: string; timeline: Array<{ id: string; type: string }> }>;
}>;
```

Parameters:

| Param           | Type                                       | Description                                                        |
| --------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `touchStoneXML` | `string \| stream-like object with pipe()` | TouchStone XML content or stream.                                  |
| `options`       | `object`                                   | Mapper hooks used to inject tasks around runs, blocks, and trials. |

Supported mapper options:

| Option      | Description                                                                        |
| ----------- | ---------------------------------------------------------------------------------- |
| `preRun`    | Add task(s) before each run timeline.                                              |
| `postRun`   | Add task(s) after each run timeline.                                               |
| `preBlock`  | Add task(s) before each block.                                                     |
| `postBlock` | Add task(s) after each block.                                                      |
| `trial`     | Map each trial into one or more tasks. Defaults to a built-in `trial` task mapper. |

Mapper values can be:

1. A string task type.
2. A task object.
3. An array of string/task values.
4. A function returning one of the above.

When a task does not provide `id`, the converter generates one.

## Example

```js
import convertTouchstone from '@lightmill/convert-touchstone';

// Map each run to a task inserted before run trials.
const preRun = (run, experiment) => ({ ...run, type: 'pre-run' });

// Mappers can also be strings.
const postRun = 'post-run';

// ...arrays (if several tasks should be inserted)...
const preBlock = [{ type: 'pre-block-1' }, { type: 'pre-block-2' }];

// ...or functions returning arrays.
const postBlock = (block, run, experiment) => [
  { type: 'post-block-1', runId: run.id },
  { ...block, type: 'post-block-2' },
];

const design = await convertTouchstone(xml, {
  preBlock,
  postBlock,
  preRun,
  postRun,
});
```
