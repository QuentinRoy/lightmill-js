---
'@lightmill/counterbalancing': major
---

Add `@lightmill/counterbalancing`, which generates condition orders to counterbalance runs: `latinSquare`, `permutations`, and `randomOrders`. It replaces `@quentinroy/latin-square`, whose `latinSquare` only balanced an odd number of conditions when asked; the new one balances by default. Use `latinSquare(conditions, { balanced: false })` for `latinSquare(conditions)`, `latinSquare(conditions)` for `latinSquare(conditions, true)`, and pass `Array.from({ length: n }, (_, i) => i)` as conditions for `latinSquare(n)`.
