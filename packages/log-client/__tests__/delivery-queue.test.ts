import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  DeliveryQueue,
  DiscardedError,
  type SendFailure,
  type SendHooks,
} from '../src/delivery-queue.ts';

interface TestItem {
  number: number;
  size: number;
}

interface SentBatch {
  numbers: number[];
  hooks: SendHooks;
  finish: (failure: SendFailure | null) => void;
}

const item = (number: number, size = 1): TestItem => ({ number, size });
const tooLarge = () => ({ error: new Error('Too large'), tooLarge: true });
const failure = (message = 'Failed') => ({ error: new Error(message) });

// Each batch waits for the test to finish it.
function createQueue({
  throttleMs = 0,
  budget = 100,
}: { throttleMs?: number; budget?: number } = {}) {
  const sent: SentBatch[] = [];
  const queue = new DeliveryQueue<TestItem>({
    send: (items, hooks) =>
      new Promise((resolve) => {
        sent.push({
          numbers: items.map(({ number }) => number),
          hooks,
          finish: resolve,
        });
      }),
    throttleMs,
    budget,
  });
  return { queue, sent };
}

async function tick() {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DeliveryQueue batches', () => {
  test('items added in the same tick share a batch', async () => {
    const { queue, sent } = createQueue();
    const stored = [queue.add(item(1)), queue.add(item(2))];
    await tick();
    expect(sent.map((batch) => batch.numbers)).toEqual([[1, 2]]);
    sent[0].finish(null);
    await Promise.all(stored);
    expect(queue.state).toEqual({ status: 'idle' });
  });

  test('sends one batch at a time, the next taking everything queued meanwhile', async () => {
    const { queue, sent } = createQueue();
    void queue.add(item(1));
    await tick();
    void queue.add(item(2));
    void queue.add(item(3));
    await tick();
    expect(sent).toHaveLength(1);
    sent[0].finish(null);
    await tick();
    expect(sent.map((batch) => batch.numbers)).toEqual([[1], [2, 3]]);
  });

  test('stays within the budget, but sends an oversized item alone', async () => {
    const { queue, sent } = createQueue({ budget: 10 });
    void queue.add(item(1, 6));
    void queue.add(item(2, 4));
    void queue.add(item(3, 1));
    void queue.add(item(4, 50));
    void queue.add(item(5, 1));
    await tick();
    for (let i = 0; i < 4; i++) {
      sent[i].finish(null);
      await tick();
    }
    expect(sent.map((batch) => batch.numbers)).toEqual([[1, 2], [3], [4], [5]]);
  });

  test('is sending while items are in flight', async () => {
    const { queue, sent } = createQueue();
    const listener = vi.fn();
    queue.subscribe(listener);
    const stored = queue.add(item(1));
    expect(queue.state).toEqual({ status: 'sending' });
    expect(queue.inFlight).toEqual([item(1)]);
    await tick();
    sent[0].finish(null);
    await stored;
    expect(queue.state).toEqual({ status: 'idle' });
    expect(queue.inFlight).toEqual([]);
    expect(listener.mock.calls).toEqual([
      [{ status: 'sending' }],
      [{ status: 'idle' }],
    ]);
  });
});

describe('DeliveryQueue throttle', () => {
  test('waits throttleMs between the starts of two batches', async () => {
    const { queue, sent } = createQueue({ throttleMs: 1000 });
    void queue.add(item(1));
    await tick();
    sent[0].finish(null);
    await tick();
    void queue.add(item(2));
    await vi.advanceTimersByTimeAsync(999);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent.map((batch) => batch.numbers)).toEqual([[1], [2]]);
  });

  test('flushUpTo skips the throttle', async () => {
    const { queue, sent } = createQueue({ throttleMs: 1000 });
    void queue.add(item(1));
    await tick();
    sent[0].finish(null);
    await tick();
    const stored = queue.add(item(2));
    await tick();
    expect(sent).toHaveLength(1);
    const waited = queue.flushUpTo(2);
    await tick();
    expect(sent).toHaveLength(2);
    sent[1].finish(null);
    await Promise.all([stored, waited]);
  });

  test('flushUpTo leaves later items throttled', async () => {
    const { queue, sent } = createQueue({ throttleMs: 1000 });
    void queue.add(item(1));
    await tick();
    sent[0].finish(null);
    await tick();
    void queue.add(item(2));
    void queue.flushUpTo(2);
    await tick();
    sent[1].finish(null);
    await tick();
    void queue.add(item(3));
    await tick();
    expect(sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toHaveLength(3);
  });
});

describe('DeliveryQueue flushUpTo', () => {
  test('resolves at once when no item is in flight', async () => {
    const { queue } = createQueue();
    await queue.flushUpTo(10);
  });

  test('resolves once the items up to the number are stored', async () => {
    const { queue, sent } = createQueue();
    void queue.add(item(1));
    await tick();
    void queue.add(item(2));
    const settled = vi.fn();
    void queue.flushUpTo(1).then(settled);
    await tick();
    expect(settled).not.toHaveBeenCalled();
    sent[0].finish(null);
    await tick();
    expect(settled).toHaveBeenCalled();
  });
});

describe('DeliveryQueue too large batches', () => {
  test('halves the budget and resends the batch', async () => {
    const { queue, sent } = createQueue({ budget: 100 });
    const stored = [1, 2, 3, 4].map((n) => queue.add(item(n, 10)));
    await tick();
    expect(sent[0].numbers).toEqual([1, 2, 3, 4]);
    sent[0].finish(tooLarge());
    await tick();
    expect(sent[1].numbers).toEqual([1, 2]);
    expect(queue.state).toEqual({ status: 'sending' });
    sent[1].finish(null);
    await tick();
    expect(sent[2].numbers).toEqual([3, 4]);
    sent[2].finish(null);
    await Promise.all(stored);
  });

  test('pauses when a single item is too large', async () => {
    const { queue, sent } = createQueue();
    const stored = queue.add(item(1));
    const rejection = expect(stored).rejects.toThrow('Too large');
    await tick();
    sent[0].finish(tooLarge());
    await rejection;
    expect(queue.state).toMatchObject({ status: 'paused' });
  });
});

describe('DeliveryQueue pause', () => {
  test('rejects the batch, holds every item and sends nothing more', async () => {
    const { queue, sent } = createQueue();
    const first = queue.add(item(1));
    const firstRejection = expect(first).rejects.toThrow('Failed');
    await tick();
    void queue.add(item(2));
    const error = failure().error;
    sent[0].finish({ error });
    await firstRejection;
    await tick();
    expect(queue.state).toEqual({ status: 'paused', error });
    expect(queue.inFlight).toEqual([item(1), item(2)]);
    expect(sent).toHaveLength(1);
    void queue.add(item(3));
    await tick();
    expect(sent).toHaveLength(1);
    expect(queue.inFlight).toEqual([item(1), item(2), item(3)]);
  });

  test('flushUpTo rejects while paused', async () => {
    const { queue, sent } = createQueue();
    void queue.add(item(1)).catch(() => {});
    await tick();
    const waited = queue.flushUpTo(1);
    const rejection = expect(waited).rejects.toThrow('Failed');
    sent[0].finish(failure());
    await rejection;
    await expect(queue.flushUpTo(1)).rejects.toThrow('Failed');
  });

  test('retry() sends the held items again, skipping the throttle', async () => {
    const { queue, sent } = createQueue({ throttleMs: 10_000 });
    const first = queue.add(item(1));
    const firstRejection = expect(first).rejects.toThrow('Failed');
    await tick();
    sent[0].finish(failure());
    await firstRejection;
    const later = queue.add(item(2));
    const retried = queue.retry();
    await tick();
    expect(queue.state).toEqual({ status: 'sending' });
    expect(sent.map((batch) => batch.numbers)).toEqual([[1], [1, 2]]);
    sent[1].finish(null);
    await Promise.all([retried, later]);
    expect(queue.state).toEqual({ status: 'idle' });
  });

  test('retry() waits for the items held when it was called only', async () => {
    const { queue, sent } = createQueue();
    void queue.add(item(1)).catch(() => {});
    await tick();
    sent[0].finish(failure());
    await tick();
    const retried = queue.retry();
    await tick();
    void queue.add(item(2));
    sent[1].finish(null);
    await retried;
    expect(queue.inFlight).toEqual([item(2)]);
  });

  test('retry() rejects when the queue pauses again', async () => {
    const { queue, sent } = createQueue();
    void queue.add(item(1)).catch(() => {});
    await tick();
    sent[0].finish(failure());
    await tick();
    const retried = queue.retry();
    const rejection = expect(retried).rejects.toThrow('Still failing');
    await tick();
    sent[1].finish(failure('Still failing'));
    await rejection;
    expect(queue.state).toMatchObject({ status: 'paused' });
  });

  test('retry() does nothing unless paused', async () => {
    const { queue, sent } = createQueue();
    await queue.retry();
    void queue.add(item(1));
    await tick();
    await queue.retry();
    expect(sent).toHaveLength(1);
  });

  test('shows retries until the batch is stored', async () => {
    const { queue, sent } = createQueue();
    const stored = queue.add(item(1));
    await tick();
    const error = new Error('Network down');
    sent[0].hooks.onRetry({ error, attempt: 1, delayMs: 250 });
    expect(queue.state).toEqual({
      status: 'retrying',
      error,
      attempt: 1,
      delayMs: 250,
    });
    sent[0].finish(null);
    await stored;
    expect(queue.state).toEqual({ status: 'idle' });
  });
});

describe('DeliveryQueue#discard', () => {
  test('returns the items in flight and rejects their promises', async () => {
    const { queue, sent } = createQueue();
    const first = queue.add(item(1));
    const firstRejection = expect(first).rejects.toBeInstanceOf(DiscardedError);
    await tick();
    const second = queue.add(item(2));
    const secondRejection =
      expect(second).rejects.toBeInstanceOf(DiscardedError);
    expect(queue.discard()).toEqual([item(1), item(2)]);
    await Promise.all([firstRejection, secondRejection]);
    expect(queue.state).toEqual({ status: 'idle' });
    expect(queue.inFlight).toEqual([]);
    expect(sent[0].hooks.isCanceled()).toBe(true);
  });

  test('ignores the outcome of the batch it dropped', async () => {
    const { queue, sent } = createQueue();
    void queue.add(item(1)).catch(() => {});
    await tick();
    queue.discard();
    sent[0].finish(failure());
    await tick();
    expect(queue.state).toEqual({ status: 'idle' });
  });

  test('drops the items a paused queue holds', async () => {
    const { queue, sent } = createQueue();
    void queue.add(item(1)).catch(() => {});
    await tick();
    sent[0].finish(failure());
    await tick();
    expect(queue.discard()).toEqual([item(1)]);
    expect(queue.state).toEqual({ status: 'idle' });
  });

  test('cancels a scheduled batch', async () => {
    const { queue, sent } = createQueue({ throttleMs: 1000 });
    void queue.add(item(1));
    await tick();
    sent[0].finish(null);
    await tick();
    void queue.add(item(2)).catch(() => {});
    queue.discard();
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent).toHaveLength(1);
  });
});
