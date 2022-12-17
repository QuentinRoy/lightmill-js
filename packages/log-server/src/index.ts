import { App } from './app.js';
import { z } from 'zod';
import dotenv from 'dotenv';
import { Store } from './store.js';

dotenv.config();

const env = z
  .object({
    PORT: z.number().optional().default(3000),
    DB_PATH: z.string().optional().default('./data.sqlite'),
  })
  .parse(process.env);

let store = new Store(env.DB_PATH);
const { error, results } = await store.migrateDatabase();
results?.forEach((it) => {
  if (it.status === 'Success') {
    console.log(`migration "${it.migrationName}" was executed successfully`);
  } else if (it.status === 'Error') {
    console.error(`failed to execute migration "${it.migrationName}"`);
  }
});
if (error) {
  console.error('failed to run `migrateToLatest`');
  console.error(error);
  process.exit(1);
}

console.log(`Listening on port ${env.PORT}`);
App({ store }).listen(env.PORT);
