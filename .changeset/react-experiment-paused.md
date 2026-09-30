---
'@lightmill/react-experiment': minor
---

`Run` has a new `paused` prop and an `elements.paused` element. While `paused` is `true`, `Run` keeps rendering the running task, then renders `elements.paused` instead of what comes next, including `elements.completed`. The timeline and `onCompleted` are not affected. The unload confirmation stays on while paused, even once the timeline is completed. `Run` throws a new `LogDeliveryError` if `paused` is set without `elements.paused`. The README shows how to set `paused` from a `@lightmill/log-client` logger's state.
