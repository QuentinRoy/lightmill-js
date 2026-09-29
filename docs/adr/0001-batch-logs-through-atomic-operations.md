# Batch logs through JSON:API Atomic Operations, not a batch resource

JSON:API only lets a create request carry one resource, so sending many logs at once needs either the official Atomic Operations extension or an invented `log-batches` resource. We use Atomic Operations on `POST /operations`, restricted to `add` of logs in one run: creating many logs is exactly what `add` operations mean, whereas `log-batches` would be a resource clients can create but never read back. The cost is a router that parses the `ext` media type parameter.

Duplicate logs succeed without being stored again, so a request resent after a lost response (by the client or by the browser itself) is safe, and `409 LOG_NUMBER_EXISTS` only means a real conflict.
