# LightMill Connection

LightMill connection provides two interface:
- `serverInterface`: low-level interface toward the experiment server (typically, [LightMill](https://github.com/QuentinRoy/LightMill))
- `runInterface`: low-level interface toward a particular experimental run.

Typically, these interfaces are not used directly but through [`lightmill-runner`](../lightmill-runner).