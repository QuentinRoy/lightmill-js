---
'@lightmill/react-experiment': patch
---

Fix `Run` losing or repeating tasks under StrictMode, including with async timelines and `resumeAfterTask`: every task now renders exactly once, in order. `onCompleted` is no longer called once `Run` has been unmounted, and an error thrown by the timeline that is not an `Error` now keeps the thrown value as its `cause`.
