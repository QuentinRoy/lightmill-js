import { expectTypeOf, it } from 'vitest';
import type {
  CompleteTaskOf,
  LoggableLogOf,
  TaskOf,
  TaskResultOf,
} from '../src/config.js';

// Checked by `pnpm typecheck`. The helpers take the registration as a
// parameter: augmenting RegisterExperiment here would type every other test.
type Registration = {
  task:
    | { type: 'trial'; id: string }
    | { type: 'survey'; id: string }
    | { type: 'intro'; id: string };
  log:
    | { type: 'trial'; taskId: string; date?: Date; answer: number }
    | { type: 'survey'; comment?: string; answeredAt?: Date }
    | { type: 'note'; text: string };
};

it('derives a task result from the registered completion log', () => {
  expectTypeOf<TaskResultOf<Registration, 'trial'>>().toEqualTypeOf<{
    answer: number;
  }>();
  expectTypeOf<TaskResultOf<Registration, 'intro'>>().toBeNever();
});

it('requires a result only when the completion log has a required field', () => {
  const check = (
    trial: CompleteTaskOf<Registration, 'trial'>,
    survey: CompleteTaskOf<Registration, 'survey'>,
    intro: CompleteTaskOf<Registration, 'intro'>,
  ) => {
    trial({ answer: 1 });
    // @ts-expect-error - answer is required.
    trial();
    survey();
    survey({ comment: 'ok' });
    intro();
    // @ts-expect-error - intro has no completion log, so no result.
    intro({ answer: 1 });
  };
  void check;
});

it('rejects reserved keys in a result', () => {
  const check = (
    trial: CompleteTaskOf<Registration, 'trial'>,
    unregistered: CompleteTaskOf<object, 'trial'>,
  ) => {
    // @ts-expect-error - taskId is set by the completion log.
    trial({ answer: 1, taskId: 'x' });
    // @ts-expect-error - type is the task's type.
    unregistered({ type: 'x' });
    // @ts-expect-error - date is set by the logger.
    unregistered({ date: new Date() });
    unregistered({ anything: 1 });
    unregistered();
  };
  void check;
});

it('rejects non-JSON values in a result', () => {
  const check = (
    survey: CompleteTaskOf<Registration, 'survey'>,
    unregistered: CompleteTaskOf<object, 'trial'>,
  ) => {
    // @ts-expect-error - a Date would come back as a string on replay.
    survey({ answeredAt: new Date() });
    // @ts-expect-error - a function is not JSON.
    unregistered({ callback: () => {} });
    unregistered({ nested: { list: [1, 'a', null, true] } });
  };
  void check;
});

it('excludes task types from the logs useLogger writes', () => {
  expectTypeOf<LoggableLogOf<Registration>>().toEqualTypeOf<{
    type: 'note';
    text: string;
  }>();
  // Without registered tasks, no log type is reserved.
  expectTypeOf<LoggableLogOf<{ log: Registration['log'] }>>().toEqualTypeOf<
    Registration['log']
  >();
});

it('requires registered tasks to have a string or number id', () => {
  expectTypeOf<TaskOf<{ task: { type: 'a'; id: number } }>>().toEqualTypeOf<{
    type: 'a';
    id: number;
  }>();
  expectTypeOf<TaskOf<{ task: { type: 'a'; id: Date } }>>().toBeNever();
  expectTypeOf<TaskOf<{ task: { type: 'a' } }>>().toBeNever();
});
