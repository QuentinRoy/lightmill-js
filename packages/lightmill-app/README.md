# LightMill App

LightMill App provides basic standard views common in many user experiments:
- `wait(node, message)`: Shows a waiting wheel. `message` is currently ignored.
- `blockInit(node, blockInfo)`: Shows a block initialization view, stating if it is a practice block
or a measured block, and displaying potential block factor values.
- `end(node)`
- `crash(node, message, error, run)`: Shows an error view.

Each views can be rendered directly by calling the corresponding function.

Additionally, the main export is also a constructor that can be extended to create an application that implements all the above handlers.
Provided that the subclass implements the `runTrial` handler, it can be directly used with [`lightmill-client`](../lightmill-client).