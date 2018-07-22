import { reduceAsyncIterator } from './utils';

const wait = t =>
  new Promise(resolve => {
    setTimeout(resolve, t);
  });

test('reduceAsyncIterator', async () => {
  async function* gen() {
    yield 0;
    await wait(0);
    yield 1;
    await wait(0);
    yield 4;
    await wait(0);
    yield 9;
  }
  // Without init.
  await expect(reduceAsyncIterator(gen(), (acc, v) => acc + v)).resolves.toBe(
    14
  );
  // With init.
  await expect(
    reduceAsyncIterator(gen(), (acc, v, i) => [...acc, { v, i }], [])
  ).resolves.toEqual([
    { v: 0, i: 0 },
    { v: 1, i: 1 },
    { v: 4, i: 2 },
    { v: 9, i: 3 }
  ]);

  // With (not always) async transform.
  await expect(
    reduceAsyncIterator(
      gen(),
      (acc, v, i) =>
        v % 2 > 0 ? wait(0).then(() => [...acc, { v, i }]) : [...acc, { v, i }],
      []
    )
  ).resolves.toEqual([
    { v: 0, i: 0 },
    { v: 1, i: 1 },
    { v: 4, i: 2 },
    { v: 9, i: 3 }
  ]);
});
