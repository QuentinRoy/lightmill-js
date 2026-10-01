---
'@lightmill/react-experiment': minor
---

`Run` can show a screen while logs cannot be delivered. Set the new `paused` prop to `true` and provide `elements.paused`: `Run` keeps rendering the running task, then renders `elements.paused` instead of what comes next, including `elements.completed`. The timeline and `onCompleted` are not affected, and `confirmBeforeUnload` stays on while paused, even once the timeline is completed. Providing `elements.paused` is recommended: without it, `Run` throws a new `LogDeliveryError` saying that logs could not be delivered.
