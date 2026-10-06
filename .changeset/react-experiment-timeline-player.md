---
'@lightmill/react-experiment': major
---

Rename `Run` to `TimelinePlayer`, and `RunElements` to `TimelinePlayerElements`. The component plays a timeline but does not manage the run it belongs to on the server, so `Run` named it wrongly. To migrate, replace `Run` with `TimelinePlayer` and `RunElements` with `TimelinePlayerElements`; props are unchanged.
