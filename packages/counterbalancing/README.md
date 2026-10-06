# @lightmill/counterbalancing

Decide the order in which each participant goes through the conditions of an experiment.

When every participant sees the conditions in the same order, learning and fatigue affect the last conditions more than the first ones. Counterbalancing varies the order across participants so these effects cancel out. This package generates the orders; you then give one to each participant.

## Install

```sh
npm install @lightmill/counterbalancing
```

## Example

```ts
import { latinSquare } from '@lightmill/counterbalancing';

const orders = latinSquare(['mouse', 'touch', 'pen'], { balanced: true });
// [
//   ['mouse', 'touch', 'pen'],
//   ['touch', 'pen', 'mouse'],
//   ['pen', 'mouse', 'touch'],
//   ['pen', 'touch', 'mouse'],
//   ['mouse', 'pen', 'touch'],
//   ['touch', 'mouse', 'pen'],
// ]

const order = orders[participantNumber % orders.length];
```

Every function returns a list of orders. Give participant `i` the order `orders[i % orders.length]`. Counterbalancing is complete when the number of participants is a multiple of `orders.length`.

## Strategies

| Function                                       | Orders  | What it guarantees                                                                                                                                                                          |
| ---------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `latinSquare(conditions)`                      | n       | Each condition appears once at every position.                                                                                                                                              |
| `latinSquare(conditions, { balanced: true })`  | n or 2n | Also, each condition comes right before every other condition equally often. With an even number of conditions, the square is balanced anyway; with an odd number, this doubles the orders. |
| `permutations(conditions)`                     | n!      | Every possible order, once.                                                                                                                                                                 |
| `randomOrders(conditions, { count, random? })` | `count` | Independent random orders. Nothing is guaranteed, but no order is favored.                                                                                                                  |

`n` is the number of conditions.

A balanced latin square also counters carryover effects: the effect one condition has on the condition right after it. Prefer it when such effects are likely, such as learning a technique that helps with the next one.

`randomOrders` uses `Math.random` by default. To get the same orders each time, for example to rebuild a participant's timeline when they resume, pass a seeded random number generator that returns numbers in [0, 1):

```ts
// mulberry32, a small seeded random number generator.
function seededRandom(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const [order] = randomOrders(conditions, {
  count: 1,
  random: seededRandom(participantNumber),
});
```

Every function throws a `TypeError` when `conditions` is empty or has duplicates, since the orders would not be counterbalanced. `randomOrders` throws a `RangeError` when `count` is not a non-negative integer.

## Assigning orders to participants

The package does not know your participants: you choose which order each one gets. Number them from 0 or 1, for example through the experiment's URL, and use that number as the index.

Participants who drop out leave holes in the rotation. Replace them by giving their number to a new participant, so every order is used as often as the others.

## From orders to a timeline

An order is a list of conditions. Turn it into a timeline by expanding each condition into its tasks:

```ts
const order = latinSquare(['mouse', 'touch', 'pen'])[participantNumber % 3];

const timeline = order.flatMap((device) => [
  { type: 'instructions', id: `${device}-instructions`, device },
  ...Array.from({ length: 10 }, (_, i) => ({
    type: 'trial',
    id: `${device}-${i}`,
    device,
  })),
]);
```

With several factors, counterbalance the factor whose order matters, and nest the others inside each of its blocks, or counterbalance the combinations of their levels as conditions. For a factor that varies between participants, give each participant one level, again by participant number.
