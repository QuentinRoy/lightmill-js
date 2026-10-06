---
'@lightmill/react-experiment': major
---

Rename `Run` to `TimelinePlayer`, and `RunElements` to `TimelinePlayerElements`. The component plays a timeline but does not manage the run it belongs to on the server, so the name `Run` is freed for a component that does. To migrate, replace `Run` with `TimelinePlayer` in imports and JSX; props are unchanged.
