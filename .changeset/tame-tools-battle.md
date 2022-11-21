---
'@lightmill/static-design': major
---

Static Design and Run Iterator APIs has changed:
  - Run Iterator is now called Timeline Iterator since it only concerns itself with agnostically running a succession of tasks, and not blocks or trials as before.
  - StaticDesign is now a class and must be called with `new`.
  - The `runs` property of the StaticDesign's constructor argument has been renamed to `timelines`.
  - StaticDesign#startRun is now StaticDesign#startTimeline.
  - StaticDesign#getAvailableRuns is now StaticDesign#getAvailableTimelines.
