---
'@lightmill/react-experiment': minor
---

`TimelinePlayer` can show a screen while logs cannot be delivered. Set the new `paused` prop to `true` and provide `elements.paused`: `TimelinePlayer` keeps rendering the running task, then renders `elements.paused` instead of what comes next, including `elements.completed`. The timeline and `onCompleted` are not affected. Providing `elements.paused` is recommended: without it, `TimelinePlayer` throws a new `LogDeliveryError` saying that logs could not be delivered.
