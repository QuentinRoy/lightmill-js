# Change Log

## 3.0.0-beta.25

### Patch Changes

- 2d3d87e: Remove package.json engines directive which fixes a warning when consumer uses a different node version.

## 3.0.0-alpha.6

### Major Changes

- 115aa44: Static Design and Run Iterator APIs has changed:
  - Run Iterator is now called Timeline Iterator since it only concerns itself with agnostically running a succession of tasks, and not blocks or trials as before.
  - StaticDesign is now a class and must be called with `new`.
  - The `runs` property of the StaticDesign's constructor argument has been renamed to `timelines`.
  - StaticDesign#startRun is now StaticDesign#startTimeline.
  - StaticDesign#getAvailableRuns is now StaticDesign#getAvailableTimelines.

### Minor Changes

- 4bbaa8e: Refactor to typescript. The library now provides typescript types.

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

<a name="3.0.0-alpha.4"></a>

# [3.0.0-alpha.4](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/store/compare/v3.0.0-alpha.3...v3.0.0-alpha.4) (2018-08-20)

### Features

- change UMD global exports ([ddbcbd2](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/store/commit/ddbcbd2))

### BREAKING CHANGES

- Global exports (when the packages are directly install from script tag in the HTML) are now contained in the `lightmill` namespace.

<a name="3.0.0-alpha.3"></a>

# [3.0.0-alpha.3](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/store/compare/v3.0.0-alpha.2...v3.0.0-alpha.3) (2018-08-20)

### Features

- better esm export support ([d5ecdcb](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/store/commit/d5ecdcb))

<a name="3.0.0-alpha.2"></a>

# [3.0.0-alpha.2](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/store/compare/v3.0.0-alpha.1...v3.0.0-alpha.2) (2018-08-17)

**Note:** Version bump only for package @lightmill/static-design
