---
'@lightmill/counterbalancing': major
---

Add `@lightmill/counterbalancing`, which generates condition orders to counterbalance runs: `latinSquare`, `permutations`, and `randomOrders`. It replaces `@quentinroy/latin-square`: use `latinSquare(conditions, { balanced: true })` for `latinSquare(conditions, true)`, and pass `Array.from({ length: n }, (_, i) => i)` as conditions for `latinSquare(n)`.
