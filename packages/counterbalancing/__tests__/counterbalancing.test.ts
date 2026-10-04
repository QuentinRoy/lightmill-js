import { describe, expect, it } from 'vitest';
import {
  balancedLatinSquare,
  latinSquare,
  permutations,
  randomOrders,
} from '../src/main.js';

describe('latinSquare', () => {
  it('returns a balanced latin square for an even number of conditions', () => {
    expect(latinSquare(['A', 'B', 'C', 'D'])).toEqual([
      ['A', 'B', 'D', 'C'],
      ['B', 'C', 'A', 'D'],
      ['C', 'D', 'B', 'A'],
      ['D', 'A', 'C', 'B'],
    ]);
  });

  it('returns one order per condition for an odd number of conditions', () => {
    expect(latinSquare(['A', 'B', 'C', 'D', 'E'])).toEqual([
      ['A', 'B', 'E', 'C', 'D'],
      ['B', 'C', 'A', 'D', 'E'],
      ['C', 'D', 'B', 'E', 'A'],
      ['D', 'E', 'C', 'A', 'B'],
      ['E', 'A', 'D', 'B', 'C'],
    ]);
  });

  it('returns a single order for a single condition', () => {
    expect(latinSquare(['A'])).toEqual([['A']]);
  });
});

describe('balancedLatinSquare', () => {
  it('returns one order per condition for an even number of conditions', () => {
    expect(balancedLatinSquare(['A', 'B', 'C', 'D'])).toEqual([
      ['A', 'B', 'D', 'C'],
      ['B', 'C', 'A', 'D'],
      ['C', 'D', 'B', 'A'],
      ['D', 'A', 'C', 'B'],
    ]);
  });

  it('returns two orders per condition for an odd number of conditions', () => {
    expect(balancedLatinSquare(['A', 'B', 'C', 'D', 'E'])).toEqual([
      ['A', 'B', 'E', 'C', 'D'],
      ['B', 'C', 'A', 'D', 'E'],
      ['C', 'D', 'B', 'E', 'A'],
      ['D', 'E', 'C', 'A', 'B'],
      ['E', 'A', 'D', 'B', 'C'],
      ['D', 'C', 'E', 'B', 'A'],
      ['E', 'D', 'A', 'C', 'B'],
      ['A', 'E', 'B', 'D', 'C'],
      ['B', 'A', 'C', 'E', 'D'],
      ['C', 'B', 'D', 'A', 'E'],
    ]);
  });

  it('returns a single order for a single condition', () => {
    expect(balancedLatinSquare(['A'])).toEqual([['A']]);
  });
});

describe('permutations', () => {
  it('returns every order of the conditions', () => {
    expect(permutations(['A', 'B', 'C'])).toEqual([
      ['A', 'B', 'C'],
      ['A', 'C', 'B'],
      ['B', 'A', 'C'],
      ['B', 'C', 'A'],
      ['C', 'A', 'B'],
      ['C', 'B', 'A'],
    ]);
  });

  it('returns a single order for a single condition', () => {
    expect(permutations(['A'])).toEqual([['A']]);
  });
});

// Linear congruential generator, so the tests can replay a random sequence.
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

describe('randomOrders', () => {
  it('returns count orders of the conditions', () => {
    const orders = randomOrders(['A', 'B', 'C', 'D'], { count: 3 });
    expect(orders).toHaveLength(3);
    for (const order of orders) {
      expect(order.toSorted()).toEqual(['A', 'B', 'C', 'D']);
    }
  });

  it('draws from the given random source', () => {
    const conditions = ['A', 'B', 'C', 'D', 'E'];
    const orders = randomOrders(conditions, {
      count: 4,
      random: seededRandom(1),
    });
    expect(
      randomOrders(conditions, { count: 4, random: seededRandom(1) }),
    ).toEqual(orders);
    expect(
      randomOrders(conditions, { count: 4, random: seededRandom(2) }),
    ).not.toEqual(orders);
  });

  it('keeps duplicate conditions', () => {
    const orders = randomOrders(['S', 'S', 'L', 'L'], { count: 3 });
    for (const order of orders) {
      expect(order.toSorted()).toEqual(['L', 'L', 'S', 'S']);
    }
  });

  it('returns no orders when count is 0', () => {
    expect(randomOrders(['A', 'B'], { count: 0 })).toEqual([]);
  });

  it('rejects empty conditions', () => {
    expect(() => randomOrders([], { count: 1 })).toThrow(TypeError);
  });

  it.each([-1, 1.5, NaN])('rejects a count of %s', (count) => {
    expect(() => randomOrders(['A', 'B'], { count })).toThrow(RangeError);
  });
});

describe.each([
  ['latinSquare', latinSquare],
  ['balancedLatinSquare', balancedLatinSquare],
  ['permutations', permutations],
])('%s', (_, strategy) => {
  it('rejects empty conditions', () => {
    expect(() => strategy([])).toThrow(TypeError);
  });

  it('rejects duplicate conditions', () => {
    expect(() => strategy(['A', 'B', 'A'])).toThrow(TypeError);
  });
});
