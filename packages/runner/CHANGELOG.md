# Change Log

## 4.0.0

### Major Changes

- [#447](https://github.com/QuentinRoy/lightmill-js/pull/447) [`9af28a5`](https://github.com/QuentinRoy/lightmill-js/commit/9af28a529dd1e324d7786d44c08482a015654e6f) - Rename the `run` export to `runTimeline`, `RunParams` to `RunTimelineParams`, and `Runner` to `TimelineRunner`. A run is the server-side entity with a lifecycle, and `run()` only walks a timeline, so `run` named it wrongly. To migrate, replace `run` with `runTimeline`, `RunParams` with `RunTimelineParams`, and `Runner` with `TimelineRunner`.

### Minor Changes

- [#391](https://github.com/QuentinRoy/lightmill-js/pull/391) [`3d7ba85`](https://github.com/QuentinRoy/lightmill-js/commit/3d7ba85388cc0e56df5c19528f6dbf3d71549214) - `TimelineRunner` and `runTimeline` accept a timeline iterator whose `next()` returns a promise on some calls only, such as one that turns async partway through. The new `MaybeAsyncIterator` type describes it.

### Patch Changes

- [#451](https://github.com/QuentinRoy/lightmill-js/pull/451) [`f0bda21`](https://github.com/QuentinRoy/lightmill-js/commit/f0bda21b2542a9f9a161448eace05ee13909edb0) - Fix `TimelineRunner#cancel()` being overridden when called from `onTimelineStarted` or `onTaskCompleted`. The runner stays `canceled` and no longer starts the next task.

- [#404](https://github.com/QuentinRoy/lightmill-js/pull/404) [`d67d0ab`](https://github.com/QuentinRoy/lightmill-js/commit/d67d0ab27ff1de93c7ca1a74aa320945462eb258) - Fix `TimelineRunner#cancel()` not stopping a pending async `next()`. A canceled runner no longer starts the task it resolves with, nor reports its rejection through `onError`.

- [#443](https://github.com/QuentinRoy/lightmill-js/pull/443) [`e0b395a`](https://github.com/QuentinRoy/lightmill-js/commit/e0b395a5e746a359832d6cbd153758580a5a94fe) - Fix `TimelineRunner#cancel()` never calling `onTimelineCanceled`. It now calls it once, after the status changes to `canceled`.

- [#392](https://github.com/QuentinRoy/lightmill-js/pull/392) [`64958f8`](https://github.com/QuentinRoy/lightmill-js/commit/64958f862fd5d38bc48670e690fbdd76b50ebf8f) - Fix `completeTask()` called from `onTaskStarted` overflowing the stack on long synchronous timelines (around 3,000 tasks). The next task now starts once `onTaskStarted` returns, so code after `completeTask()` in `onTaskStarted` runs before the next task starts instead of after the rest of the timeline. Calling `completeTask()` twice from the same `onTaskStarted` now throws instead of completing the next task, and a throwing `onTaskStarted` now sets the runner's status to `crashed`, unless it canceled the runner.

- [#391](https://github.com/QuentinRoy/lightmill-js/pull/391) [`3d7ba85`](https://github.com/QuentinRoy/lightmill-js/commit/3d7ba85388cc0e56df5c19528f6dbf3d71549214) - Fix errors thrown by a sync timeline bypassing `onError`. They escaped from `start()` or `completeTask()` and left the runner `running`. They now go to `onError` and set the status to `crashed`, like errors from async timelines, and are still thrown when there is no `onError`.

## 3.1.0-beta.0

### Minor Changes

- [#391](https://github.com/QuentinRoy/lightmill-js/pull/391) [`3d7ba85`](https://github.com/QuentinRoy/lightmill-js/commit/3d7ba85388cc0e56df5c19528f6dbf3d71549214) - `Runner` and `run` accept a timeline iterator whose `next()` returns a promise on some calls only, such as one that turns async partway through. The new `MaybeAsyncIterator` type describes it.

### Patch Changes

- [#392](https://github.com/QuentinRoy/lightmill-js/pull/392) [`64958f8`](https://github.com/QuentinRoy/lightmill-js/commit/64958f862fd5d38bc48670e690fbdd76b50ebf8f) - Fix `completeTask()` called from `onTaskStarted` overflowing the stack on long synchronous timelines (around 3,000 tasks). The next task now starts once `onTaskStarted` returns, so code after `completeTask()` in `onTaskStarted` runs before the next task starts instead of after the rest of the timeline. Calling `completeTask()` twice from the same `onTaskStarted` now throws instead of completing the next task, and a throwing `onTaskStarted` now sets the runner's status to `crashed`.

- [#391](https://github.com/QuentinRoy/lightmill-js/pull/391) [`3d7ba85`](https://github.com/QuentinRoy/lightmill-js/commit/3d7ba85388cc0e56df5c19528f6dbf3d71549214) - Fix errors thrown by a sync timeline bypassing `onError`. They escaped from `start()` or `completeTask()` and left the runner `running`. They now go to `onError` and set the status to `crashed`, like errors from async timelines, and are still thrown when there is no `onError`.

## 3.0.0

### Major Changes

- 37f1b03: New Runner API as default export. The old `run` function is still available as a named export.
- a35f3f9: Runner API has changed. Runner is now provided as a single run function, and the store argument has been removed.
- d2f8ed5: Remove Runner as a default export. There is no default export anymore. Runner is provided as a named export. RunnerProps type is now exported.
- aed9788: Update Runner interface.
- 4bbaa8e: Distribute package as ES module only.

### Minor Changes

- 4bbaa8e: Refactor to typescript. The library now provides typescript types.

### Patch Changes

- 2d3d87e: Remove package.json engines directive which fixes a warning when consumer uses a different node version.

## 3.0.0-beta.25

### Patch Changes

- 2d3d87e: Remove package.json engines directive which fixes a warning when consumer uses a different node version.

## 3.0.0-beta.23

### Major Changes

- aed9788: Update Runner interface.

## 3.0.0-alpha.10

### Major Changes

- d2f8ed5: Remove Runner as a default export. There is no default export anymore. Runner is provided as a named export. RunnerProps type is now exported.

## 3.0.0-alpha.9

### Major Changes

- 37f1b03: New Runner API as default export. The old `run` function is still available as a named export.

## 3.0.0-alpha.6

### Major Changes

- a35f3f9: Runner API has changed. Runner is now provided as a single run function, and the store argument has been removed.
- 4bbaa8e: Distribute package as ES module only.

### Minor Changes

- 4bbaa8e: Refactor to typescript. The library now provides typescript types.

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

<a name="3.0.0-alpha.4"></a>

# [3.0.0-alpha.4](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/compare/v3.0.0-alpha.3...v3.0.0-alpha.4) (2018-08-20)

### Bug Fixes

- **runner:** fix esm export ([db4595c](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/db4595c))

### Features

- change UMD global exports ([ddbcbd2](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/ddbcbd2))

### BREAKING CHANGES

- Global exports (when the packages are directly install from script tag in the HTML) are now contained in the `lightmill` namespace.

<a name="3.0.0-alpha.3"></a>

# [3.0.0-alpha.3](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/compare/v3.0.0-alpha.2...v3.0.0-alpha.3) (2018-08-20)

### Features

- better esm export support ([d5ecdcb](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/d5ecdcb))
- **runner:** stores' log method now takes the log as first argument ([8c9c518](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/8c9c518))

### BREAKING CHANGES

- **runner:** Store interface has changed

<a name="3.0.0-alpha.2"></a>

# [3.0.0-alpha.2](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/compare/v3.0.0-alpha.1...v3.0.0-alpha.2) (2018-08-17)

### Bug Fixes

- **runner:** fix first task always being skipped ([e5f543c](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/e5f543c))

### Features

- **runner:** new interface for the stores ([b776bbb](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/b776bbb))
- **runner:** refactor runner to remove babel-runtime dependency ([47832c0](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/47832c0))
- **runner:** rename runner.start() to run ([57349c1](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/57349c1))
- **runner:** rename runner's taskManager argument to runTask ([b1fdaf4](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/b1fdaf4))

### BREAKING CHANGES

- **runner:** runner's taskManager argument have been rename to runTask
- **runner:** runner.start has been rename to run.
- **runner:** Stores do not need to implement `log` anymore but should implement `getLogger(logType)` that returns the corresponding logger instead.

<a name="2.0.0-3"></a>

# 2.0.0-3 (2017-08-08)

<a name="2.0.0-2"></a>

# 2.0.0-2 (2017-06-27)

### Bug Fixes

- **lightmill-runner:** `runExperiment` calls `app.crash` then throws if a trial goes wrong. ([7da8203](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/7da8203))
- **run-experiment:** Adapt to new connection interface. ([f4a2297](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/f4a2297))

### Features

- **lightmill-runner:** `runTrials` throws if a post fails. ([cbf61d8](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/cbf61d8))

<a name="2.0.0-1"></a>

# 2.0.0-1 (2017-06-25)

<a name="2.0.0-0"></a>

# 2.0.0-0 (2017-06-25)

<a name="2.0.0-2"></a>

# 2.0.0-2 (2017-06-27)

### Bug Fixes

- **lightmill-runner:** `runExperiment` calls `app.crash` then throws if a trial goes wrong. ([7da8203](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/7da8203))
- **run-experiment:** Adapt to new connection interface. ([f4a2297](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/f4a2297))

### Features

- **lightmill-runner:** `runTrials` throws if a post fails. ([cbf61d8](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/cbf61d8))

<a name="2.0.0-1"></a>

# 2.0.0-1 (2017-06-25)

<a name="2.0.0-0"></a>

# 2.0.0-0 (2017-06-25)

<a name="2.0.0-1"></a>

# 2.0.0-1 (2017-06-25)

<a name="2.0.0-0"></a>

# 2.0.0-0 (2017-06-25)

<a name="2.0.0-0"></a>

# 2.0.0-0 (2017-06-25)
