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
import { latinSquare } from '@lightmill/counterbalancing';

const orders = latinSquare(['mouse', 'touch', 'pen']);
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

| Function                                       | Orders returned                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `latinSquare(conditions, { balanced? })`       | n, or 2n for an odd n above 1 when balanced (the default). Each condition appears once at every position; balanced, each also precedes every other one equally often, which counterbalances first-order carryover effects. `balanced: false` keeps n orders, halving the runs a complete rotation needs. |
| `permutations(conditions)`                     | n!, every order.                                                                                                                                                                                                                                                                                         |
| `randomOrders(conditions, { count, random? })` | `count` independent shuffles. `random` returns a number in [0, 1) and defaults to `Math.random`; pass a seeded generator to reproduce the orders.                                                                                                                                                        |

`n` is the number of conditions. Every function throws a `TypeError` when
`conditions` is empty. All but `randomOrders` also throw a `TypeError` when
`conditions` contains duplicates, since the orders would not be counterbalanced;
`randomOrders` accepts them, e.g., to shuffle repeated trials. `randomOrders`
throws a `RangeError` when `count` is not a non-negative integer.
