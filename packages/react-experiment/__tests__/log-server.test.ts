import { Client } from '@lightmill/log-client';
import { serverTest } from '@lightmill/test-server';
import { expect } from 'vitest';

serverTest(
  'a log added through a real client is stored by the server',
  async ({ server }) => {
    await server.addExperiment('test-experiment');
    const client = new Client({ apiRoot: server.apiRoot });
    const logger = await client.startRun({
      experimentName: 'test-experiment',
      runName: 'test-run',
    });

    const date = new Date('2022-12-31T23:00:00.000Z');
    await logger.addLog({ type: 'trial', date, answer: 'yes' });
    await logger.flush();

    await expect(server.storedLogs()).resolves.toEqual([
      {
        number: 1,
        type: 'trial',
        values: { answer: 'yes', date: date.toISOString() },
      },
    ]);
  },
);
