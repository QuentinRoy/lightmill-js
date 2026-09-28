# Lightmill

Tools to run HCI experiments and collect their logs on a server.

## Language

**Missing log number**:
A log number in a run's current log sequence, at or after its start and below the highest log number received, for which the server holds no log.
_Avoid_: placeholder, pending log (server side), empty log

**Pending log**:
A log a client has sent but the server has not yet acknowledged. Client-side only.
_Avoid_: missing log
