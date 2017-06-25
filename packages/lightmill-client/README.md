# LightMill Client

LightMill client connects to [`LightMill`](https://github.com/QuentinRoy/LightMill) and runs experiment.

It is also able to automatically import an experiment design file into the server if it has not been loaded before.
Currently, the server supports experiment design file in the [Touchstone](https://www.lri.fr/%7Eappert/website/touchstone/touchstone.html) format as exported by Touchstone's [design platform](https://github.com/jdfekete/touchstone-platforms/tree/master/design-platform).

LightMill client exports one function: `runExperiment(app, config)`:

`app` is an object that defines the following handlers to be called during the experiment process:
- `app.runTrial(trialInfo):Promise`: Run a trial.
- `app.start():Promise` (optional): Initialize the experiment.
- `app.initRun(runInfo):Promise` (optional): Initialize the run.
- `app.initBlock(blockInfo):Promise` (optional): Initialize a block.
- `app.end()` (optional): Called when the experiment ends.
- `app.crash(message, error, run)` (optional): Called when an error is thrown during the run.

`config` is an object that defines the following properties:
- `config.experimentId`: The identifier of the experiment.
- `config.runId` (optional): The identifier of a potential target run.
- `config.serverAddr` (default: hostname:5000): The address of the server .
- `config.experimentDesignAddr` (optional): The path toward an experiment design file to be imported into the server if the experiment has not been loaded yet.
- `config.queueSize` (default: 1): The maximum number of pending trial result posts before starting a new trial. More parallel posts means that there is less change the user will be waiting before a trial starts, but also increases the number of trials that might be lost in case a trial fails to be recorded.