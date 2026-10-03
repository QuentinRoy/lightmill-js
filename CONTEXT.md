# Lightmill

Tools to run HCI experiments and collect their logs on a server.

## Language

**Missing log number**:
A log number in a run's current log sequence, at or after its start and below the highest log number received, for which the server holds no log.
_Avoid_: placeholder, pending log, empty log

**Stranded log**:
A log the server holds whose number is above the run's first missing log number. It stops being stranded once every missing log number below it is filled.
_Avoid_: pending log, unconfirmed log, out-of-order log

**Last log**:
The last log of a given type in a run that isn't stranded. A run can be resumed after it.
_Avoid_: latest log

**Last log number**:
The highest log number in a run that isn't stranded, or 0 if there is none.
_Avoid_: max log number

**In-flight log**:
A log added to a client that the server has not yet acknowledged, whether queued, being sent, or held after a failure. Client-side only.
_Avoid_: pending log, missing log, unsent log

**Resume**:
Restarting a run's logging after a given log number, canceling every log above it. Only allowed after a number no higher than the run's last log number.
_Avoid_: rewind, restart

**Canceled log**:
A log whose number is at or above where a later resume of its run starts. The server keeps it, but it no longer counts toward the run.

**Duplicate log**:
A log sent with the number, type, and values of a log the server already holds in the run's current log sequence. Storing it again changes nothing. A log with the same number but different content is a conflict, not a duplicate.

**Ended run**:
A run that is completed or canceled.
_Avoid_: closed run, finished run, terminal run

**Ongoing run**:
A run that has not ended: idle, running, or interrupted.
_Avoid_: active run, open run

**Idle run**:
A run that was created but not started. It accepts no logs. It is ongoing.
