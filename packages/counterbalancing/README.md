# @lightmill/counterbalancing

Generate condition orders to counterbalance experiment runs.

## Install

```sh
npm install @lightmill/counterbalancing
```

## Usage

Every strategy returns a list of orders. Give run `i` the order
`orders[i % orders.length]`; `orders.length` is the number of runs a complete
rotation needs.

```ts
import { balancedLatinSquare } from '@lightmill/counterbalancing';

const orders = balancedLatinSquare(['mouse', 'touch', 'pen']);
// [
//   ['mouse', 'touch', 'pen'],
//   ['touch', 'pen', 'mouse'],
//   ['pen', 'mouse', 'touch'],
//   ['pen', 'touch', 'mouse'],
//   ['mouse', 'pen', 'touch'],
//   ['touch', 'mouse', 'pen'],
// ]
const order = orders[runIndex % orders.length];
```

## API Reference

| Function                                       | Orders returned                                                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `latinSquare(conditions)`                      | n. Each condition appears once at every position. Balanced when n is even.                                                                        |
| `balancedLatinSquare(conditions)`              | n, or 2n when n is odd. Each condition also precedes every other one equally often, which counterbalances first-order carryover effects.          |
| `permutations(conditions)`                     | n!, every order.                                                                                                                                  |
| `randomOrders(conditions, { count, random? })` | `count` independent shuffles. `random` returns a number in [0, 1) and defaults to `Math.random`; pass a seeded generator to reproduce the orders. |

`n` is the number of conditions. Every function throws a `TypeError` when
`conditions` is empty. All but `randomOrders` also throw a `TypeError` when
`conditions` contains duplicates, since the orders would not be counterbalanced;
`randomOrders` accepts them, e.g., to shuffle repeated trials. `randomOrders`
throws a `RangeError` when `count` is not a non-negative integer.
