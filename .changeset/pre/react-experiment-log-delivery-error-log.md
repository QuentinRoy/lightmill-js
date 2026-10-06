---
'@lightmill/react-experiment': minor
---

When `onLog` rejects, `TimelinePlayer` now throws a `LogDeliveryError` with the log it could not deliver in its new `log` property, so an error boundary can recover it. It used to throw a plain `Error` that lost the log.
