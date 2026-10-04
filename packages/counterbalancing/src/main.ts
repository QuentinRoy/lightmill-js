/**
 * Creates a latin square of condition orders: each condition appears once in
 * every order and once at every position across orders.
 *
 * With an even number of conditions, the square is also balanced: each
 * condition precedes every other condition exactly once.
 *
 * @param conditions The conditions to order.
 * @returns One order per condition.
 */
export function latinSquare<T>(conditions: readonly T[]): T[][] {
  checkConditions(conditions);
  const n = conditions.length;
  const firstRow = Array.from({ length: n }, (_, i) => {
    if (i < 2) return i;
    if (i % 2 === 0) return n - i / 2;
    return Math.floor(i / 2) + 1;
  });
  return conditions.map((_, shift) =>
    firstRow.map((i) => conditions[(i + shift) % n]),
  );
}

/**
 * Creates a balanced latin square of condition orders: a latin square where
 * each condition precedes every other condition equally often, which
 * counterbalances first-order carryover effects.
 *
 * @param conditions The conditions to order.
 * @returns One order per condition, or two with an odd number of conditions.
 */
export function balancedLatinSquare<T>(conditions: readonly T[]): T[][] {
  const orders = latinSquare(conditions);
  if (conditions.length % 2 === 0) return orders;
  // With an odd number of conditions, the square alone is not balanced.
  // Adding its reversed orders balances it.
  return [...orders, ...orders.map((order) => order.toReversed())];
}

/**
 * Lists every order of the conditions. Complete counterbalancing needs one run
 * per order, i.e., n! runs for n conditions.
 *
 * @param conditions The conditions to order.
 * @returns Every order of the conditions.
 */
export function permutations<T>(conditions: readonly T[]): T[][] {
  checkConditions(conditions);
  return allOrders(conditions);
}

function allOrders<T>(conditions: readonly T[]): T[][] {
  if (conditions.length <= 1) return [[...conditions]];
  return conditions.flatMap((first, i) =>
    allOrders(conditions.toSpliced(i, 1)).map((rest) => [first, ...rest]),
  );
}

/**
 * Shuffles the conditions independently for each order. Unlike the other
 * strategies, duplicate conditions are allowed, e.g., to shuffle repeated
 * trials.
 *
 * @param conditions The conditions to order.
 * @param options How many orders to create, and how.
 * @param options.count The number of orders to create.
 * @param options.random Returns a number in [0, 1). Pass a seeded generator to
 * reproduce the orders. Defaults to `Math.random`.
 * @returns `count` orders.
 */
export function randomOrders<T>(
  conditions: readonly T[],
  { count, random = Math.random }: { count: number; random?: () => number },
): T[][] {
  checkConditions(conditions, { allowDuplicates: true });
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`count must be a non-negative integer, got ${count}`);
  }
  return Array.from({ length: count }, () => {
    const order = [...conditions];
    // Fisher–Yates shuffle.
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  });
}

function checkConditions(
  conditions: readonly unknown[],
  { allowDuplicates = false } = {},
) {
  if (conditions.length === 0) {
    throw new TypeError('conditions must not be empty');
  }
  // Duplicates would produce orders that look counterbalanced but are not.
  if (!allowDuplicates && new Set(conditions).size !== conditions.length) {
    throw new TypeError('conditions must not contain duplicates');
  }
}
