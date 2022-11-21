# Change Log

## 3.0.0-alpha.8

### Major Changes

- 508deac: Update export result so it matches @lightmill/static-design argument: (1) ensure ids are provided or generated for every tasks, (2) rename result's `runs` property to `timelines`.

## 3.0.0-alpha.7

### Major Changes

- 4bbaa8e: New convert touchstone API. Mapper options have been renamed to be singular: `preBlocks` is now `preBlock`, `trials` is now `trial`, etc.
- 4bbaa8e: Distribute package as ES module only.

### Minor Changes

- 4bbaa8e: Refactor to typescript. The library now provides typescript types.

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

<a name="3.0.0-alpha.6"></a>

# [3.0.0-alpha.6](https://github.com/QuentinRoy/lightmill-js/compare/v3.0.0-alpha.5...v3.0.0-alpha.6) (2018-08-24)

### Features

- **convert-touchstone:** mappers for post/pre blocks/runs and trials ([5adb177](https://github.com/QuentinRoy/lightmill-js/commit/5adb177))

### BREAKING CHANGES

- **convert-touchstone:** The trialsType options has been rename to trials. The blockStartupType option has been rename to preBlocks.

<a name="3.0.0-alpha.4"></a>

# [3.0.0-alpha.4](https://github.com/QuentinRoy/lightmill-js/compare/v3.0.0-alpha.3...v3.0.0-alpha.4) (2018-08-20)

### Bug Fixes

- **convert-touchstone:** fix esm export ([96d50f5](https://github.com/QuentinRoy/lightmill-js/commit/96d50f5))

### Features

- change UMD global exports ([ddbcbd2](https://github.com/QuentinRoy/lightmill-js/commit/ddbcbd2))

### BREAKING CHANGES

- Global exports (when the packages are directly install from script tag in the HTML) are now contained in the `lightmill` namespace.

<a name="3.0.0-alpha.3"></a>

# [3.0.0-alpha.3](https://github.com/QuentinRoy/lightmill-js/compare/v3.0.0-alpha.2...v3.0.0-alpha.3) (2018-08-20)

### Features

- better esm export support ([d5ecdcb](https://github.com/QuentinRoy/lightmill-js/commit/d5ecdcb))

<a name="3.0.0-alpha.2"></a>

# [3.0.0-alpha.2](https://github.com/QuentinRoy/lightmill-js/compare/v3.0.0-alpha.1...v3.0.0-alpha.2) (2018-08-17)

**Note:** Version bump only for package @lightmill/convert-touchstone
