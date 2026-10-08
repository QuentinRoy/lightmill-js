import type { Client, Logger } from '@lightmill/log-client';
import { it } from 'vitest';
import type { RegisteredLog } from '../src/config.js';
import type { RunClient, RunLogger } from '../src/logClient.js';

// These assignments are checked by `pnpm typecheck`: they fail to compile when
// log-client drifts from the interface Run uses.
type TypedLog =
  | { type: 'trial'; id: string }
  | { type: 'trial-done'; taskId: string; date?: Date };

it('accepts a log-client Client and Logger', () => {
  const check = (
    client: Client,
    logger: Logger,
    typedClient: Client<TypedLog>,
    typedLogger: Logger<TypedLog>,
  ) => {
    const runClient: RunClient<RegisteredLog> = client;
    const runLogger: RunLogger<RegisteredLog> = logger;
    const typedRunClient: RunClient<TypedLog> = typedClient;
    const typedRunLogger: RunLogger<TypedLog> = typedLogger;
    return [runClient, runLogger, typedRunClient, typedRunLogger];
  };
  void check;
});
