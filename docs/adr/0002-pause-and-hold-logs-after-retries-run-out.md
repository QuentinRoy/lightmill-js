# Pause and hold logs when retries run out

When a batch of logs still fails after its retries run out, the logger stops sending and keeps every in-flight log instead of dropping it. The failed batch's `addLog` promises reject, but later logs stay held with their promises pending until `retry()` sends them again. Ending a run while logs are held rejects, unless the caller passes `discardInFlightLogs` to `cancelRun` or `interruptRun`; `completeRun` never discards. Losing logs is the worst failure, and a logger that gave up and moved on would leave a gap that only a resume could close, canceling every later log.

The alternative was to retry transient errors forever and never give up. That hides an outage from callers who only watch promises, so the logger instead gives up after a bounded time and reports it through rejections and a `pause` event, while still holding the data.
