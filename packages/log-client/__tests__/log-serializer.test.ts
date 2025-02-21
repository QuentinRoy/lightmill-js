import { anyLogSerializer } from '../src/log-serializer.js';
import { test } from 'vitest';

test('anyLogSerializer should serialize a log', ({ expect }) => {
  expect(
    anyLogSerializer({
      date: new Date('2023-01-01T00:00:00Z'),
      message: 'test',
      somethingUndefined: undefined,
      somethingNull: null,
      some: {
        nested: {
          value: { date: new Date('2025-01-01T00:00:00Z'), number: -9 },
        },
      },
    }),
  ).toEqual({
    date: '2023-01-01T00:00:00.000Z',
    message: 'test',
    somethingNull: null,
    some: {
      nested: { value: { date: '2025-01-01T00:00:00.000Z', number: -9 } },
    },
  });
});
