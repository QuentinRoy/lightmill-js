# LightMill

[![Greenkeeper badge](https://badges.greenkeeper.io/QuentinRoy/lightmill-js.svg)](https://greenkeeper.io/)

[![Build Status](https://travis-ci.org/QuentinRoy/lightmill-js.svg?branch=master)](https://travis-ci.org/QuentinRoy/lightmill-js)
[![codecov](https://img.shields.io/codecov/c/github/QuentinRoy/lightmill-js.svg)](https://codecov.io/gh/QuentinRoy/lightmill-js)

LightMill is a framework used to manage, run and log user experiments.
Its main component, LightMill, is a python server hosted [here](https://github.com/QuentinRoy/LightMill).

This repository stores the JS components that goes with the aforementioned server:
- [lightmill-runner](./packages/lightmill-runner) used to run experiments,
- [lightmill-app](./packages/lightmill-app) that implements some standard views that appears during an experiment,
- [lightmill-connection](./packages/lightmill-connection) provides interfaces toward the LightMill server and a particular run of an experiment on LightMill's server.
