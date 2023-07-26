#!/usr/bin/env node

import path from 'node:path';
import fs from 'node:fs/promises';
import { readFileSync, createWriteStream } from 'node:fs';
import * as url from 'node:url';
import express from 'express';
import { z } from 'zod';
import dotenv from 'dotenv';
import cors from 'cors';
import loglevel from 'loglevel';
import yargs from 'yargs';
import { Store, createLogServer } from './index.js';
import { csvExportStream, jsonExportStream } from './export.js';

// Constants and setup
// -------------------

dotenv.config();

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

const env = z
  .object({
    SECRET: z.string().optional(),
    ADMIN_PASSWORD: z.string().optional(),
    PORT: z.number().default(3000),
    DB_PATH: z.string().default('./data.sqlite'),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error'])
      .default('info'),
  })
  .parse(process.env);

const { version } = z
  .object({ version: z.string() })
  .parse(
    JSON.parse(readFileSync(path.join(__dirname, '../package.json'), 'utf8')),
  );

const dbPath = path.normalize(env.DB_PATH);

loglevel.setLevel(env.LOG_LEVEL);
const log = loglevel.getLogger('main');

// Command handlers
// ----------------

type StartParameter = {
  database: string;
  port: number;
  secret?: string;
  adminPassword?: string;
};
async function start({
  database: dbPath,
  port,
  secret,
  adminPassword,
}: StartParameter) {
  if (secret == null) {
    log.error(
      'No secret set. Set the SECRET environment variable or use the --secret option.',
    );
    process.exit(1);
  }
  let doesDbExist = await fs.access(dbPath, fs.constants.F_OK).then(
    () => true,
    () => false,
  );
  let store = new Store(dbPath);
  if (!doesDbExist) {
    let { error } = await store.migrateDatabase();
    if (error != null) {
      log.info('Failed to initialize database');
      log.error(error);
      process.exit(1);
    }
  }
  let server = express()
    .use(cors())
    .use(createLogServer({ store, secret, adminPassword }))
    .listen(port, () => {
      log.info(`Listening on port ${port}`);
    });
  process.on('SIGTERM', () => {
    server.close((error) => {
      if (error != null) {
        log.error(error);
      }
      store.close().catch((error) => {
        log.error(error);
        process.exit(1);
      });
      if (error != null) {
        process.exit(1);
      }
    });
  });
}

type ExportLogsParameter = {
  database: string;
  format: 'json' | 'csv';
  output?: string;
  logType?: string;
  experimentId?: string;
};
async function exportLogs({
  database,
  format,
  logType,
  experimentId,
  output = undefined,
}: ExportLogsParameter) {
  let filter = { type: logType, experimentId };
  let store = new Store(database);
  let stream =
    format === 'csv'
      ? csvExportStream(store, filter)
      : jsonExportStream(store, filter);
  if (output === undefined) {
    stream.pipe(process.stdout).on('error', handleError);
  } else {
    stream.pipe(createWriteStream(output)).on('error', handleError);
  }
}

type MigrateDatabaseParameter = {
  database: string;
};
async function migrateDatabase({ database }: MigrateDatabaseParameter) {
  let store = new Store(database);
  let { error, results } = await store.migrateDatabase();
  results?.forEach((it) => {
    if (it.status === 'Success') {
      log.info(`migration "${it.migrationName}" was executed successfully`);
    } else if (it.status === 'Error') {
      log.error(`failed to execute migration "${it.migrationName}"`);
    }
  });
  if (error) {
    log.error(`failed to migrate ${database}`);
    log.error(error);
    process.exit(1);
  } else {
    log.info(`${database} migration successful`);
  }
}

// Command line interface
// ----------------------

yargs(process.argv.slice(2))
  .command(
    'start',
    'Start the server',
    (yargs) => {
      return yargs
        .option('database', {
          alias: 'd',
          desc: 'Path to the database file',
          type: 'string',
          normalize: true,
          default: dbPath,
        })
        .option('port', {
          alias: 'p',
          desc: 'Port to listen on',
          type: 'number',
          default: env.PORT,
        })
        .option('secret', {
          alias: 's',
          desc: 'Secret to use for signing client cookies',
          type: 'string',
          default: env.SECRET,
        })
        .option('admin-password', {
          alias: 'a',
          desc: 'Password for the admin user',
          type: 'string',
          default: env.ADMIN_PASSWORD,
        })
        .help()
        .alias('help', 'h')
        .strict();
    },
    (argv) => start(argv).catch(handleError),
  )
  .command(
    'migrate',
    'Migrate the database',
    (yargs) =>
      yargs
        .option('database', {
          alias: 'd',
          desc: 'Path to the database file',
          type: 'string',
          normalize: true,
          default: dbPath,
        })
        .strict()
        .help()
        .alias('help', 'h'),
    (argv) => migrateDatabase(argv).catch(handleError),
  )
  .command(
    'export',
    'Export logs',
    (yargs) => {
      return yargs
        .option('format', {
          alias: 'f',
          choices: ['json', 'csv'] as const,
          default: 'json' as const,
        })
        .option('output', {
          alias: 'o',
          desc: 'Path to the output file',
          type: 'string',
          normalize: true,
        } as const)
        .option('database', {
          alias: 'd',
          desc: 'Path to the database file',
          type: 'string',
          normalize: true,
          default: dbPath,
        })
        .option('logType', {
          alias: 't',
          type: 'string',
        })
        .option('experimentId', {
          alias: 'e',
          type: 'string',
        })
        .strict()
        .help()
        .alias('help', 'h');
    },
    (argv) => exportLogs(argv).catch(handleError),
  )
  .demandCommand(1)
  .scriptName('log-server')
  .version(version)
  .alias('version', 'V')
  .usage('Usage: $0 <command> [options]')
  .help()
  .alias('help', 'h')
  .strict().argv;

function handleError(error: unknown) {
  log.error(error);
  process.exit(1);
}
