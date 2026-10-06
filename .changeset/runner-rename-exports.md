---
'@lightmill/runner': major
---

Rename the `run` export to `runTimeline`, `RunParams` to `RunTimelineParams`, and `Runner` to `TimelineRunner`. A run is the server-side entity with a lifecycle, and `run()` only walks a timeline, so `run` named it wrongly. To migrate, replace `run` with `runTimeline`, `RunParams` with `RunTimelineParams`, and `Runner` with `TimelineRunner`.
