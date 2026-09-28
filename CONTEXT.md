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
A log a client has sent but the server has not yet acknowledged. Client-side only.
_Avoid_: pending log, missing log

**Resume**:
Restarting a run's logging after a given log number, canceling every log above it. Only allowed after a number no higher than the run's last log number.
_Avoid_: rewind, restart

**Canceled log**:
A log whose number is at or above where a later resume of its run starts. It no longer counts toward the run.
