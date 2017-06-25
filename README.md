# LightMill

LightMill is a framework used to manage, run and log user experiments.
Its main component, LightMill, is a python server hosted [here](https://github.com/QuentinRoy/LightMill).

This repository stores the JS components that goes with the aforementioned server:
- [lightmill-runner](./packages/lightmill-runner) used to run experiments,
- [lightmill-app](./packages/lightmill-app) that implements some standard views that appears during an experiment,
- [lightmill-connection](./packages/lightmill-connection) provides interfaces toward the LightMill server and a particular run of an experiment on LightMill's server.