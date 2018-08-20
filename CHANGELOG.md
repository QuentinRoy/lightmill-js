# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

<a name="3.0.0-alpha.3"></a>
# [3.0.0-alpha.3](https://github.com/QuentinRoy/lightmill-js/compare/v3.0.0-alpha.2...v3.0.0-alpha.3) (2018-08-20)


### Features

* better esm export support ([d5ecdcb](https://github.com/QuentinRoy/lightmill-js/commit/d5ecdcb))
* **runner:** stores' log method now takes the log as first argument ([8c9c518](https://github.com/QuentinRoy/lightmill-js/commit/8c9c518))


### BREAKING CHANGES

* **runner:** Store interface has changed




<a name="3.0.0-alpha.2"></a>
# [3.0.0-alpha.2](https://github.com/QuentinRoy/lightmill-js/compare/v3.0.0-alpha.1...v3.0.0-alpha.2) (2018-08-17)


### Bug Fixes

* temporarily revert to lerna 2 ([b78d441](https://github.com/QuentinRoy/lightmill-js/commit/b78d441)), closes [marionebl/commitlint#406](https://github.com/marionebl/commitlint/issues/406)
* **runner:** fix first task always being skipped ([e5f543c](https://github.com/QuentinRoy/lightmill-js/commit/e5f543c))


### Features

* **runner:** new interface for the stores ([b776bbb](https://github.com/QuentinRoy/lightmill-js/commit/b776bbb))
* **runner:** refactor runner to remove babel-runtime dependency ([47832c0](https://github.com/QuentinRoy/lightmill-js/commit/47832c0))
* **runner:** rename runner.start() to run ([57349c1](https://github.com/QuentinRoy/lightmill-js/commit/57349c1))
* **runner:** rename runner's taskManager argument to runTask ([b1fdaf4](https://github.com/QuentinRoy/lightmill-js/commit/b1fdaf4))


### BREAKING CHANGES

* **runner:** runner's taskManager argument  have been rename to runTask
* **runner:** runner.start has been rename to run.
* **runner:** Stores do not need to implement `log` anymore but should implement `getLogger(logType)` that returns the corresponding logger instead.




<a name=""></a>
# [](https://github.com/QuentinRoy/lightmill-js/compare/v2.0.0...v) (2018-08-10)


### Chores

* remove [@lightmill](https://github.com/lightmill)/app ([e92b5ae](https://github.com/QuentinRoy/lightmill-js/commit/e92b5ae))
* remove [@lightmill](https://github.com/lightmill)/connection ([361fb59](https://github.com/QuentinRoy/lightmill-js/commit/361fb59))
* rename all packages under the namespace [@lightmill](https://github.com/lightmill) ([75e29ca](https://github.com/QuentinRoy/lightmill-js/commit/75e29ca))
* update ci ([#28](https://github.com/QuentinRoy/lightmill-js/issues/28)) ([43d3f00](https://github.com/QuentinRoy/lightmill-js/commit/43d3f00))


### Features

* **convert-touchstone:** conversion from touchstone XML design files ([ec9e5cc](https://github.com/QuentinRoy/lightmill-js/commit/ec9e5cc))
* **runner:** new runner ([1175c89](https://github.com/QuentinRoy/lightmill-js/commit/1175c89))
* **static-design:** static design ([dbf9de8](https://github.com/QuentinRoy/lightmill-js/commit/dbf9de8))


### BREAKING CHANGES

* everything has been rewritten from scratch: the API has changed entirely and nothing is compatible
* lightmill-app has been deprecated
* lightmill-connection has been deprecated
* lightmill-runner has moved to @lightmill/runner and has changed entirely
* drop node 7 support
