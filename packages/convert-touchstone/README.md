# @lightmill/convert-touchstone

Convert a touchstone XML design file as produce by [touchstone](https://www.lri.fr/%7Eappert/website/touchstone/touchstone.html)'s [design platform](https://github.com/jdfekete/touchstone-platforms/tree/master/design-platform) to a format that can be directly provided to [@lightmill/static-design](../static-design).

## Install

### NPM

```sh
npm install @lightmill/convert-touchstone
```

Note: You might not need to install @lightmill/convert-touchstone, [`npx`](https://www.npmjs.com/package/npx) can be used to download and immediately run the program.

### Direct download

Download the latest version then, then in your html file:

```html
<script src="lightmill-convert-touchstone.js"></script>
```

The library will be injected in `lightmill.convertTouchstone`.

## Usage

```sh
lightmill-convert-touchstone <input-file>
```

Or (if you do not need to install it and prefer to use `npx`):

```sh
npx @lightmill/convert-touchstone <input-file>
```

## API

| Param               | Type                                                                                      | Default                        | Description                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------- |
| touchStoneXML       | <code>String</code> \| <code>stream.Readable</code>                                       |                                | The XML to parse.                                                                                  |
| [options]           | <code>object</code>                                                                       |                                | Options                                                                                            |
| [options.preBlock]  | <code>string</code> \| <code>object</code> \| <code>array</code> \| <code>function</code> |                                | The type of the task to insert before each block or a function to map the block values to task(s). |
| [options.postBlock] | <code>string</code> \| <code>object</code> \| <code>array</code> \| <code>function</code> |                                | The type of the task to insert after each block or a function to map the block values to task(s).  |
| [options.preRun]    | <code>string</code> \| <code>object</code> \| <code>array</code> \| <code>function</code> |                                | The type of the task to insert before each run or a function to map the run values to task(s).     |
| [options.postRun]   | <code>string</code> \| <code>object</code> \| <code>array</code> \| <code>function</code> |                                | The type of the task to insert after each run or a function to map the run values to task(s).      |
| [options.trial]     | <code>string</code> \| <code>object</code> \| <code>array</code> \| <code>function</code> | <code>&quot;trial&quot;</code> | The type of the task to insert for each trial or a function to map the trial values to task(s).    |

## Example

```js
// Map each run to a task to insert before the trials of the run.
const preRun = (run, experiment) => ({
  ...run,
  type: 'pre-run'
});
// Mappers can also be strings...
const postRun = 'post-run';  // This is the same as above.
// ...arrays (if several tasks need to be inserted)...
const preBlock = [
  { type: 'pre-block-1' },
  { type: 'pre-block-2' }
];
// ...or functions that returns arrays.
const postBlock = (block, run, experiment) => [
  { type: 'post-block-1', runId: run.id },
  { ...block , type: 'post-block-2' }
  'post-block-2' // This is the same as above.
];
convertTouchStone(data, { preBlock, postBlock, postRun, preRun })
  .then(doSomething);
```
