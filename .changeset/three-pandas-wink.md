---
'@lightmill/log-server': major
---

Drop run_status column from CSV export. This column is not usually needed when fetching an experiment's results, and adds noise.
