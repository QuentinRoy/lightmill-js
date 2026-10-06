---
'@lightmill/react-experiment': patch
---

Fix `useLogger` reporting "Is this component rendered in a `<Run />`?" when a task or `elements.completed` calls it in a `TimelinePlayer` without `onLog`. It now reports that `onLog` is missing.
