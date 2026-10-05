---
'@lightmill/convert-touchstone': patch
---

Fix the `lightmill-convert-touchstone` command failing at startup with `The requested module 'yargs' does not provide an export named 'command'`. Its `--trials`, `--pre-blocks`, `--post-blocks`, `--pre-runs`, and `--post-runs` options now set the `trial`, `preBlock`, `postBlock`, `preRun`, and `postRun` options of `convertTouchstone`.
