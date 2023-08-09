---
'@lightmill/log-server': major
---

Change the database schema with no provided migration. Consequently this is incompatible with old database file. This is to account for the new log api, and eventually run resuming. DO NOT UPGRADE IF YOU HAVE LOGS IN YOUR DATABASE.