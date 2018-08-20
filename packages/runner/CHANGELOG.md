# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

<a name="3.0.0-alpha.3"></a>
# [3.0.0-alpha.3](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/compare/v3.0.0-alpha.2...v3.0.0-alpha.3) (2018-08-20)


### Features

* better esm export support ([d5ecdcb](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/d5ecdcb))
* **runner:** stores' log method now takes the log as first argument ([8c9c518](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/8c9c518))


### BREAKING CHANGES

* **runner:** Store interface has changed




<a name="3.0.0-alpha.2"></a>
# [3.0.0-alpha.2](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/compare/v3.0.0-alpha.1...v3.0.0-alpha.2) (2018-08-17)


### Bug Fixes

* **runner:** fix first task always being skipped ([e5f543c](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/e5f543c))


### Features

* **runner:** new interface for the stores ([b776bbb](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/b776bbb))
* **runner:** refactor runner to remove babel-runtime dependency ([47832c0](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/47832c0))
* **runner:** rename runner.start() to run ([57349c1](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/57349c1))
* **runner:** rename runner's taskManager argument to runTask ([b1fdaf4](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/b1fdaf4))


### BREAKING CHANGES

* **runner:** runner's taskManager argument  have been rename to runTask
* **runner:** runner.start has been rename to run.
* **runner:** Stores do not need to implement `log` anymore but should implement `getLogger(logType)` that returns the corresponding logger instead.




<a name="2.0.0-3"></a>
# 2.0.0-3 (2017-08-08)



<a name="2.0.0-2"></a>
# 2.0.0-2 (2017-06-27)


### Bug Fixes

* **lightmill-runner:** `runExperiment` calls `app.crash` then throws if a trial goes wrong. ([7da8203](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/7da8203))
* **run-experiment:** Adapt to new connection interface. ([f4a2297](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/f4a2297))


### Features

* **lightmill-runner:** `runTrials` throws if a post fails. ([cbf61d8](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/cbf61d8))



<a name="2.0.0-1"></a>
# 2.0.0-1 (2017-06-25)



<a name="2.0.0-0"></a>
# 2.0.0-0 (2017-06-25)




<a name="2.0.0-2"></a>
# 2.0.0-2 (2017-06-27)


### Bug Fixes

* **lightmill-runner:** `runExperiment` calls `app.crash` then throws if a trial goes wrong. ([7da8203](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/7da8203))
* **run-experiment:** Adapt to new connection interface. ([f4a2297](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/f4a2297))


### Features

* **lightmill-runner:** `runTrials` throws if a post fails. ([cbf61d8](https://github.com/QuentinRoy/lightmill-js/tree/master/packages/lightmill-connection/commit/cbf61d8))



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
