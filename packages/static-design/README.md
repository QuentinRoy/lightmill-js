# @lightmill/static-design

Define static experiment runs and iterate tasks with resume support.

This package is often used together with [@lightmill/runner](../runner).

## Install

```sh
npm install @lightmill/static-design
```

## Usage

```ts
import StaticDesign from '@lightmill/static-design';

const design = new StaticDesign({
  id: 'exp-1',
  runs: [
    {
      id: 'run-a',
      timeline: [
        { id: 'intro', type: 'screen' },
        { id: 'trial-1', type: 'trial' },
      ],
    },
  ],
});

const runIds = design.getAvailableRuns();
const timeline = design.startRun(runIds[0]);
```

## API Reference

### `class StaticDesign<Task, RunId = string>`

| Method                           | Description                                     |
| -------------------------------- | ----------------------------------------------- |
| `new StaticDesign(config)`       | Build a static experiment from predefined runs. |
| `getAvailableRuns(startedRuns?)` | Return run IDs not already started.             |
| `startRun(runId, options?)`      | Return a `TimelineIterator` for that run.       |
| `getId()`                        | Return experiment ID.                           |

### `class TimelineIterator<Task>`

Iterator returned by `startRun(...)`.

| Method       | Description                           |
| ------------ | ------------------------------------- |
| `next()`     | Return next task in the run timeline. |
| `getRunId()` | Return run ID tied to this iterator.  |

Constructor resume options:

| Option        | Description                                      |
| ------------- | ------------------------------------------------ |
| `resumeAfter` | Task ID after which iteration should resume.     |
| `resumeWith`  | Optional task inserted right after resume point. |
