---
'@lightmill/react-experiment': patch
---

Fix `Run` losing or repeating tasks under StrictMode, including with async timelines and `resumeAfterTask`: every task now renders exactly once, in order.
