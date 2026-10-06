---
'@lightmill/convert-touchstone': patch
---

Number the default practice trial ids from 1 in each run (`practice-trial-1`, ...) instead of continuing across runs, so a run's ids no longer depend on the runs before it. Runs converted with earlier versions have different practice trial ids for every run after the first.
