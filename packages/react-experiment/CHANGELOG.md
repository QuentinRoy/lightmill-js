# @lightmill/react-experiment

## 4.0.0

### Major Changes

- [#405](https://github.com/QuentinRoy/lightmill-js/pull/405) [`29f67cf`](https://github.com/QuentinRoy/lightmill-js/commit/29f67cfaf106056de08e9c8e48f7aea9c9c2d346) - Require React 19.2 or later. React 18 and 19.0 to 19.1 are no longer supported: the test suite only runs against the latest React, and 19.2 is the first release with `<Activity>`, which `TimelinePlayer` now handles. Upgrade React, or stay on the previous release of this package.

- [#452](https://github.com/QuentinRoy/lightmill-js/pull/452) [`a298081`](https://github.com/QuentinRoy/lightmill-js/commit/a298081233768fc084a53771d8a04b395b5f3437) - `TimelinePlayer` mounts each task fresh. Consecutive tasks rendering the same component used to share it, so state, refs, and mount effects carried over from one task to the next. A trial could inherit the previous trial's answer or start time without any error. To share state between tasks, keep it above `TimelinePlayer`, in a parent component (`useState`, `useRef`, or context) or in a store outside React, and have tasks read and write it.

- [#441](https://github.com/QuentinRoy/lightmill-js/pull/441) [`31f0a5f`](https://github.com/QuentinRoy/lightmill-js/commit/31f0a5f9fb41d442c40669b2bb2a3e391b4db747) - Rename `Run` to `TimelinePlayer`, and `RunElements` to `TimelinePlayerElements`. The component plays a timeline but does not manage the run it belongs to on the server, so `Run` named it wrongly. To migrate, replace `Run` with `TimelinePlayer` and `RunElements` with `TimelinePlayerElements`.

- [#343](https://github.com/QuentinRoy/lightmill-js/pull/343) [`1544f54`](https://github.com/QuentinRoy/lightmill-js/commit/1544f543d326bf9f1f9b9f246e4f5e2aec94757d) - `TimelinePlayer` no longer replaces the running task with `elements.loading` when `loading` turns `true`. Like `paused`, it keeps rendering the task, then renders `elements.loading` instead of what comes next, including `elements.completed`. If `loading` goes back to `false` before the task ends, nothing changes on screen: the task keeps its state and timers. When `loading` and `paused` are both `true`, `elements.paused` wins. The task used to unmount, which lost what the participant had entered and restarted its timers.

- [#391](https://github.com/QuentinRoy/lightmill-js/pull/391) [`3d7ba85`](https://github.com/QuentinRoy/lightmill-js/commit/3d7ba85388cc0e56df5c19528f6dbf3d71549214) - Replace the `resumeAfter` prop of `TimelinePlayer` with `resumeAfterTask`, a function that receives each task and returns `true` for the last completed one. `TimelinePlayer` skips every task up to and including the first match, and throws if no task matches. `resumeAfter: { type, number }` counted tasks of one type, which `@lightmill/log-client` no longer provides: `getResumableRuns` returns a run-wide log number. `resumeAfter` also mishandled `number: 0`, skipping the first task or throwing. To migrate, store something that identifies the task in its logs and match on it: `resumeAfter={{ type: 'trial', number: n }}` becomes `resumeAfterTask={(task) => task.type === 'trial' && task.trialNumber === n}`. Omit the prop when no task was completed.

- [#342](https://github.com/QuentinRoy/lightmill-js/pull/342) [`5238453`](https://github.com/QuentinRoy/lightmill-js/commit/52384530ccf1a94a51573ae7ca7a9e98e53aaa7b) - Remove the `confirmBeforeUnload` prop of `TimelinePlayer`, and add the `useConfirmBeforeUnload(isEnabled)` hook, which asks the browser to confirm before the page is closed or reloaded for as long as `isEnabled` is `true` and the calling component is mounted. `TimelinePlayer` could not tell whether logs were still being sent or held, so its prompt could not protect them. Apps now decide when to prompt from what they know, such as the logger's state.
  
  `TimelinePlayer` no longer asks for confirmation by default. To keep a prompt, call the hook from a component that stays mounted. With `@lightmill/log-client`, `useConfirmBeforeUnload(!['completed', 'canceled', 'interrupted'].includes(logger.state.status))` prompts until every log is stored and the run has ended.

### Minor Changes

- [#389](https://github.com/QuentinRoy/lightmill-js/pull/389) [`1cd9c96`](https://github.com/QuentinRoy/lightmill-js/commit/1cd9c965a4f8e33daaf298479497b204cb83a9f9) - When `onLog` rejects, `TimelinePlayer` now throws a `LogDeliveryError` with the log it could not deliver in its new `log` property, so an error boundary can recover it. It used to throw a plain `Error` that lost the log.

- [#334](https://github.com/QuentinRoy/lightmill-js/pull/334) [`7bd5c33`](https://github.com/QuentinRoy/lightmill-js/commit/7bd5c334c33726eeea9602a4683105f775ebed34) - `TimelinePlayer` can show a screen while logs cannot be delivered. Set the new `paused` prop to `true` and provide `elements.paused`: `TimelinePlayer` keeps rendering the running task, then renders `elements.paused` instead of what comes next, including `elements.completed`. The timeline and `onCompleted` are not affected. Providing `elements.paused` is recommended: without it, `TimelinePlayer` throws a new `LogDeliveryError` saying that logs could not be delivered.

### Patch Changes

- [#405](https://github.com/QuentinRoy/lightmill-js/pull/405) [`29f67cf`](https://github.com/QuentinRoy/lightmill-js/commit/29f67cfaf106056de08e9c8e48f7aea9c9c2d346) - Fix `TimelinePlayer` losing or repeating tasks under StrictMode, including with async timelines and `resumeAfterTask`: every task now renders exactly once, in order. `onCompleted` is no longer called once `TimelinePlayer` has been unmounted, and an error thrown by the timeline that is not an `Error` now keeps the thrown value as its `cause`.

- [#389](https://github.com/QuentinRoy/lightmill-js/pull/389) [`1cd9c96`](https://github.com/QuentinRoy/lightmill-js/commit/1cd9c965a4f8e33daaf298479497b204cb83a9f9) - Fix `TimelinePlayer` ignoring changes to `onLog`: logs went to the `onLog` it first rendered with, so a `TimelinePlayer` first rendered with `loading` and no `onLog` threw as soon as a task logged, even once it had one. Logs now go to the current `onLog`.

- [#389](https://github.com/QuentinRoy/lightmill-js/pull/389) [`1cd9c96`](https://github.com/QuentinRoy/lightmill-js/commit/1cd9c965a4f8e33daaf298479497b204cb83a9f9) - Fix `useLogger` reporting "Is this component rendered in a `<Run />`?" when a task or `elements.completed` calls it in a `TimelinePlayer` without `onLog`. It now reports that `onLog` is missing.
- Updated dependencies [[`f0bda21`](https://github.com/QuentinRoy/lightmill-js/commit/f0bda21b2542a9f9a161448eace05ee13909edb0), [`d67d0ab`](https://github.com/QuentinRoy/lightmill-js/commit/d67d0ab27ff1de93c7ca1a74aa320945462eb258), [`9af28a5`](https://github.com/QuentinRoy/lightmill-js/commit/9af28a529dd1e324d7786d44c08482a015654e6f), [`e0b395a`](https://github.com/QuentinRoy/lightmill-js/commit/e0b395a5e746a359832d6cbd153758580a5a94fe), [`3d7ba85`](https://github.com/QuentinRoy/lightmill-js/commit/3d7ba85388cc0e56df5c19528f6dbf3d71549214), [`64958f8`](https://github.com/QuentinRoy/lightmill-js/commit/64958f862fd5d38bc48670e690fbdd76b50ebf8f), [`3d7ba85`](https://github.com/QuentinRoy/lightmill-js/commit/3d7ba85388cc0e56df5c19528f6dbf3d71549214)]:
  - @lightmill/runner@4.0.0

## 4.0.0-beta.2

### Major Changes

- [#391](https://github.com/QuentinRoy/lightmill-js/pull/391) [`3d7ba85`](https://github.com/QuentinRoy/lightmill-js/commit/3d7ba85388cc0e56df5c19528f6dbf3d71549214) - Replace the `resumeAfter` prop of `Run` with `resumeAfterTask`, a function that receives each task and returns `true` for the last completed one. `Run` skips every task up to and including the first match, and throws if no task matches. `resumeAfter: { type, number }` counted tasks of one type, which `@lightmill/log-client` no longer provides: `getResumableRuns` returns a run-wide log number. `resumeAfter` also mishandled `number: 0`, skipping the first task or throwing. To migrate, store something that identifies the task in its logs and match on it: `resumeAfter={{ type: 'trial', number: n }}` becomes `resumeAfterTask={(task) => task.type === 'trial' && task.trialNumber === n}`. Omit the prop when no task was completed.

### Minor Changes

- [#389](https://github.com/QuentinRoy/lightmill-js/pull/389) [`1cd9c96`](https://github.com/QuentinRoy/lightmill-js/commit/1cd9c965a4f8e33daaf298479497b204cb83a9f9) - When `onLog` rejects, `Run` now throws a `LogDeliveryError` with the log it could not deliver in its new `log` property, so an error boundary can recover it. It used to throw a plain `Error` that lost the log.

### Patch Changes

- [#389](https://github.com/QuentinRoy/lightmill-js/pull/389) [`1cd9c96`](https://github.com/QuentinRoy/lightmill-js/commit/1cd9c965a4f8e33daaf298479497b204cb83a9f9) - Fix `Run` ignoring changes to `onLog`: logs went to the `onLog` it first rendered with, so a `Run` first rendered with `loading` and no `onLog` threw as soon as a task logged, even once it had one. Logs now go to the current `onLog`.

- [#389](https://github.com/QuentinRoy/lightmill-js/pull/389) [`1cd9c96`](https://github.com/QuentinRoy/lightmill-js/commit/1cd9c965a4f8e33daaf298479497b204cb83a9f9) - Fix `useLogger` reporting "Is this component rendered in a `<Run />`?" when a task or `elements.completed` calls it in a `Run` without `onLog`. It now reports that `onLog` is missing.
- Updated dependencies [[`3d7ba85`](https://github.com/QuentinRoy/lightmill-js/commit/3d7ba85388cc0e56df5c19528f6dbf3d71549214), [`64958f8`](https://github.com/QuentinRoy/lightmill-js/commit/64958f862fd5d38bc48670e690fbdd76b50ebf8f), [`3d7ba85`](https://github.com/QuentinRoy/lightmill-js/commit/3d7ba85388cc0e56df5c19528f6dbf3d71549214)]:
  - @lightmill/runner@3.1.0-beta.0

## 4.0.0-beta.1

### Major Changes

- [#343](https://github.com/QuentinRoy/lightmill-js/pull/343) [`1544f54`](https://github.com/QuentinRoy/lightmill-js/commit/1544f543d326bf9f1f9b9f246e4f5e2aec94757d) - `Run` no longer replaces the running task with `elements.loading` when `loading` turns `true`. Like `paused`, it keeps rendering the task, then renders `elements.loading` instead of what comes next, including `elements.completed`. If `loading` goes back to `false` before the task ends, nothing changes on screen: the task keeps its state and timers. When `loading` and `paused` are both `true`, `elements.paused` wins. The task used to unmount, which lost what the participant had entered and restarted its timers.

- [#342](https://github.com/QuentinRoy/lightmill-js/pull/342) [`5238453`](https://github.com/QuentinRoy/lightmill-js/commit/52384530ccf1a94a51573ae7ca7a9e98e53aaa7b) - Remove the `confirmBeforeUnload` prop of `Run`, and add the `useConfirmBeforeUnload(isEnabled)` hook, which asks the browser to confirm before the page is closed or reloaded for as long as `isEnabled` is `true` and the calling component is mounted. `Run` could not tell whether logs were still being sent or held, so its prompt could not protect them. Apps now decide when to prompt from what they know, such as the logger's state.
  
  `Run` no longer asks for confirmation by default. To keep a prompt, call the hook from a component that stays mounted. With `@lightmill/log-client`, `useConfirmBeforeUnload(!['completed', 'canceled', 'interrupted'].includes(logger.state.status))` prompts until every log is stored and the run has ended.

### Minor Changes

- [#334](https://github.com/QuentinRoy/lightmill-js/pull/334) [`7bd5c33`](https://github.com/QuentinRoy/lightmill-js/commit/7bd5c334c33726eeea9602a4683105f775ebed34) - `Run` can show a screen while logs cannot be delivered. Set the new `paused` prop to `true` and provide `elements.paused`: `Run` keeps rendering the running task, then renders `elements.paused` instead of what comes next, including `elements.completed`. The timeline and `onCompleted` are not affected. Providing `elements.paused` is recommended: without it, `Run` throws a new `LogDeliveryError` saying that logs could not be delivered.

## 3.1.0-beta.0

### Minor Changes

- [#287](https://github.com/QuentinRoy/lightmill-js/pull/287) [`f7898e2`](https://github.com/QuentinRoy/lightmill-js/commit/f7898e253bef954e80f99e6f487d77d3e2533de1) - Support React 19.

## 3.0.0

### Major Changes

New @lightmill/react-experiment package to run experiments with react.

## 3.0.0-beta.30

### Patch Changes

- 3b71a26: Fix Run props type regression introduced in 6ee33d3d21882c2e6d8cc12ec0cfda5506fce46a.

## 3.0.0-beta.29

### Patch Changes

- 6ee33d3: Run's elements prop must now support every tasks in timeline, even when no task types have been provided or registered
- f6a7a82: Fix tasks being skipped when onTaskCompleted is called several times.

## 3.0.0-beta.25

### Major Changes

- f01d46f: Rename Run log prop to onLog

### Minor Changes

- 7696b2f: Add log content in use logger typing with default values.

### Patch Changes

- 2d3d87e: Remove package.json engines directive which fixes a warning when consumer uses a different node version.
- Updated dependencies [2d3d87e]
  - @lightmill/runner@3.0.0-beta.25

## 3.0.0-beta.23

### Minor Changes

- aed9788: Add resumeAfter Run prop

### Patch Changes

- Updated dependencies [aed9788]
  - @lightmill/runner@3.0.0-beta.23

## 3.0.0-beta.21

### Major Changes

- b3aec3a: Do not flush before completing a run, and do not require loggers to define a flush method.

## 3.0.0-beta.20

### Major Changes

- e3774ba: Rename Run's config prop to elements, and RunConfig type to RunElements

### Patch Changes

- 858914e: Fix logger's run not being marked as completed under run completion.

## 3.0.0-beta.19

### Minor Changes

- 6753790: manage logger errors, add Run's error property, and add useError hook

## 3.0.0-alpha.15

### Major Changes

- f2a2a74: Change API: fix run being canceled on unmount, rename useLog to useLogger, remove noConfirmOnUnload Run prop, add confirmBeforeUnload and cancelRunOnUnload Run props

## 3.0.0-alpha.13

### Major Changes

- b483585: Rename Experiment to Run to be coherent with log-server's terminology

### Minor Changes

- 0185591: Add logger support

## 3.0.0-alpha.11

### Patch Changes

- a40cb71: Fix dependencies

## 3.0.0-alpha.9

### Major Changes

- efab3bc: Creation of @lightmill/react-experiment
