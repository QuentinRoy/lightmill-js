# LightMill Client

LightMill client connects to [`LightMill`](https://github.com/QuentinRoy/LightMill) and runs experiment.

It is also able to automatically import an experiment design file into the server if it has not been loaded before.
Currently, the server supports experiment design file in the [Touchstone](https://www.lri.fr/%7Eappert/website/touchstone/touchstone.html) format as exported by Touchstone's [design platform](https://github.com/jdfekete/touchstone-platforms/tree/master/design-platform).

LightMill client exports one function: `runExperiment(app, config)`:

`app` is an object that defines the following handlers to be called during the experiment process:
- `app.runTrial(trialInfo):Promise`: Run a trial,
- `app.start:Promise`: Initialize the experiment (optional),
- `app.initRun(runInfo):Promise`: Initialize the run (optional),
- `app.initBlock(blockInfo):Promise`: Initialize a block (optional),
- `app.end`: Called when the experiment ends (optional),
- `app.crash(message, error, run)`: Called when an error is thrown during the run (optional).

`config` is an object that defines the following properties:
- `config.experimentId`: The identifier of the experiment.
- `config.runId`: The identifier of a potential target run (optional).
- `config.serverAddr`: The address of the server (default: is the port 5000 on the same host than the webpage).
- `config.experimentDesignAddr`: The path toward an experiment design file to be imported into the server if the experiment has not been loaded yet.
- `config.queueSize`: The maximum number of pending trial result posts before starting a new trial (default: 1). More parallel posts means that there is less change the user will be waiting before a trial starts, but also increases the number of trials that might be lost in case a trial fails to be recorded.