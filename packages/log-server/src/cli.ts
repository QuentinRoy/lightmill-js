#!/usr/bin/env node

import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import loglevel from 'loglevel';
import { createWriteStream, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import * as url from 'node:url';
import yargs from 'yargs';
import { z } from 'zod';
import { csvExportStream } from './csv-export.ts';
import { DataStoreError } from './data-store-errors.ts';
import { createLogServer, SQLiteDataStore } from './index.ts';
import { isValidHostPassword } from './utils.ts';

// Constants and setup
// -------------------

// dotenv logs a line about the variables it loaded; the CLI's output is its own.
dotenv.config({ quiet: true });

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

const env = z
  .object({
    SESSION_KEY: z.string().optional(),
    HOST_PASSWORD: z.string().optional(),
    ALLOWED_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin !== ''),
      ),
    PORT: z.coerce.number().default(3000),
    DB_PATH: z.string().default('./data.sqlite'),
    SESSION_MAX_AGE_DAYS: z.coerce.number().positive().finite().default(30),
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

type SecureCookies = 'auto' | 'always' | 'never';
type StartParameter = {
  database: string;
  port: number;
  sessionKey: string | undefined;
  sessionMaxAgeDays: number;
  hostPassword: string | undefined;
  sameSite: boolean;
  secureCookies: SecureCookies | undefined;
  allowedOrigin: string[];
  trustProxy: boolean;
};
async function start({
  database: dbPath,
  port,
  sessionKey,
  sessionMaxAgeDays,
  hostPassword,
  sameSite,
  secureCookies,
  allowedOrigin,
  trustProxy,
}: StartParameter) {
  if (sessionKey == null) {
    log.error(
      'No session key set. Set the SESSION_KEY environment variable or use the --session-key option.',
    );
    process.exit(1);
  }
  // A host session reads every log and cancels any run, so the server never
  // starts without a way to protect it.
  if (!isValidHostPassword(hostPassword)) {
    log.error(
      'No host password set. Set the HOST_PASSWORD environment variable or use the --host-password option.',
    );
    process.exit(1);
  }
  const sessionMaxAge = sessionMaxAgeDays * 24 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(sessionMaxAge) || sessionMaxAge <= 0) {
    throw new Error('Session max age must be a positive number of days');
  }
  let allowedOrigins = allowedOrigin.map(parseOrigin);
  if (!sameSite && allowedOrigins.length === 0) {
    throw new Error(
      'No allowed origin set. Set the ALLOWED_ORIGINS environment variable or use the --allowed-origin option to name the pages that may call this server, or use --same-site if the browser loads the page from the same site as the API.',
    );
  }
  // Browsers reject cross-site cookies without `Secure`, so only same-site
  // cookies can opt out of `always`.
  if (!sameSite && secureCookies !== undefined && secureCookies !== 'always') {
    throw new Error(
      `--secure-cookies ${secureCookies} requires --same-site: cross-site cookies are always Secure.`,
    );
  }
  // Plain HTTP development uses the same flags, so this stays a warning.
  // With `never` the cookies are not Secure whatever the proxy does.
  if (sameSite && !trustProxy && secureCookies !== 'never') {
    log.warn(
      'Session cookies are Secure only when the server is reached directly over HTTPS. Behind a reverse proxy that terminates TLS, pass --trust-proxy.',
    );
  }
  let store = await openExistingStore(dbPath);
  let app = express();
  // Browsers refuse credentialed responses that allow every origin, and any
  // site allowed here can act with a participant's session cookie, so the
  // list stays explicit. Browsers hide `Retry-After` from other origins
  // unless it is exposed, and `log-client` reads it to pace its retries.
  if (allowedOrigins.length > 0) {
    app.use(
      cors({
        origin: allowedOrigins,
        credentials: true,
        exposedHeaders: ['Retry-After'],
      }),
    );
  }
  let server = app
    .use(
      createLogServer({
        dataStore: store,
        sessionStore: store.getSessionStore(),
        sessionMaxAge,
        sessionKeys: sessionKey.split(':'),
        hostPassword,
        trustProxy,
        ...(sameSite
          ? { cookieSite: 'same-site' as const, secureCookies }
          : {}),
      }).middleware,
    )
    .listen(port);
  server.on('listening', () => {
    // With `--port 0`, the OS picks the port.
    const address = server.address();
    const boundPort =
      address != null && typeof address === 'object' ? address.port : port;
    log.info(`Listening on port ${boundPort}`);
  });
  process.on('SIGTERM', () => {
    server.close(async (error) => {
      if (error != null) {
        log.error(error);
      }
      try {
        await store.close();
      } catch (closeError) {
        log.error(closeError);
        process.exit(1);
      }
      if (error != null) process.exit(1);
    });
  });
}

// A trailing slash or a path would never match the `Origin` header browsers
// send, and the server would silently refuse the page.
function parseOrigin(value: string): string {
  let origin = URL.canParse(value) ? new URL(value).origin : null;
  if (origin !== value) {
    throw new Error(
      `Invalid allowed origin "${value}". Use an origin such as "https://example.org" or "http://localhost:5173": a scheme, a host, an optional port, and no path.`,
    );
  }
  return origin;
}

// Opens a database that `log-server migrate` already prepared, and tells the
// user to run it otherwise.
async function openExistingStore(dbPath: string) {
  let doesDbExist = await fs.access(dbPath, fs.constants.F_OK).then(
    () => true,
    () => false,
  );
  if (!doesDbExist) {
    throw new Error(
      `Database ${dbPath} does not exist. Run "log-server migrate --database ${dbPath}" to create it.`,
    );
  }
  return SQLiteDataStore.open(dbPath).catch((error) => {
    if (
      error instanceof DataStoreError &&
      error.code === DataStoreError.SCHEMA_OUTDATED
    ) {
      throw new Error(
        `Database ${dbPath} needs migrating. Back it up, then run "log-server migrate --database ${dbPath}".`,
        { cause: error },
      );
    }
    throw error;
  });
}

type ExportLogsParameter = {
  database: string;
  output?: string | undefined;
  logType?: string | undefined;
  experimentName?: string | undefined;
};
async function exportLogs({
  database,
  logType,
  experimentName,
  output = undefined,
}: ExportLogsParameter) {
  let filter = { logType, experimentName };
  let store = await openExistingStore(database);
  let stream = csvExportStream(store, filter);
  if (output === undefined) {
    stream.pipe(process.stdout).on('error', handleError);
    return;
  }
  let startDate = new Date();
  let logCount = 0;
  let isHeader = true;
  // cursorTo and clearLine only exist on a TTY.
  let showProgress = process.stdout.isTTY;
  let progress = () => `${logCount.toLocaleString('en')} logs exported...`;
  if (showProgress) process.stdout.write(progress());
  stream
    .pipe(
      new Transform({
        writableObjectMode: true,
        transform(chunk, _encoding, callback) {
          if (isHeader) {
            isHeader = false;
            return callback(null, chunk);
          }
          logCount += 1;
          if (showProgress) {
            process.stdout.cursorTo(0);
            process.stdout.write(progress());
          }
          callback(null, chunk);
        },
      }),
    )
    .pipe(createWriteStream(output))
    .on('error', handleError)
    .on('finish', () => {
      if (showProgress) {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
      }
      let durationInSeconds = (Date.now() - startDate.getTime()) / 1000;
      process.stdout.write(
        `${logCount.toLocaleString(
          'en',
        )} logs exported in ${durationInSeconds.toLocaleString(
          'en',
        )} seconds.\n`,
      );
    });
}

type MigrateDatabaseParameter = { database: string };
async function migrateDatabase({ database }: MigrateDatabaseParameter) {
  await SQLiteDataStore.migrateDatabase(database);
}

type AddExperimentParameter = { database: string; name: string };
async function addExperiment({ database, name }: AddExperimentParameter) {
  // The API requires a non-empty name, so an empty one would break GET /experiments.
  if (name === '') {
    throw new Error('The experiment name cannot be empty.');
  }
  await SQLiteDataStore.migrateDatabase(database);
  let store = await SQLiteDataStore.open(database);
  try {
    try {
      await store.withTransaction((tx) =>
        tx.addExperiment({ experimentName: name }),
      );
    } catch (error) {
      if (
        error instanceof DataStoreError &&
        error.code === DataStoreError.EXPERIMENT_EXISTS
      ) {
        throw new Error(
          `An experiment named "${name}" already exists. Choose a different name.`,
          { cause: error },
        );
      }
      throw error;
    }
    log.info(`Created experiment "${name}".`);
  } finally {
    await store.close();
  }
}

// Command line interface
// ----------------------

// yargs turns a repeated scalar option into an array. Like most CLIs, the last
// occurrence wins. yargs' `duplicate-arguments-array: false` would do the same
// but also make `--allowed-origin` keep only its last origin.
function lastOccurrence<T>(value: T | T[] | undefined): T | undefined {
  return Array.isArray(value) ? value.at(-1) : value;
}

export function cli() {
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
          .option('session-key', {
            alias: 's',
            desc: 'Secret to use for signing client cookies',
            type: 'string',
            default: env.SESSION_KEY,
          })
          .option('session-max-age-days', {
            desc: 'Days a browser session remains valid (default: 30)',
            type: 'number',
            default: env.SESSION_MAX_AGE_DAYS,
          })
          .option('host-password', {
            alias: 'w',
            desc: 'Password for the host user (required)',
            type: 'string',
            default: env.HOST_PASSWORD,
            coerce: (value: string | string[] | undefined) =>
              lastOccurrence(value),
          })
          .option('same-site', {
            desc: 'Use same-site cookies, for a browser page on the same site as the API (the port can differ). Cookies are Secure over HTTPS, not over HTTP',
            type: 'boolean',
            default: false,
          })
          .option('secure-cookies', {
            desc: 'Whether the session cookie is Secure: auto follows the request protocol (needs --trust-proxy behind a TLS-terminating proxy). Defaults to auto with --same-site, always otherwise; auto and never require --same-site',
            type: 'string',
            choices: ['auto', 'always', 'never'] as const,
            coerce: (value: SecureCookies | SecureCookies[] | undefined) =>
              lastOccurrence(value),
          })
          .option('allowed-origin', {
            desc: 'Origin of a page allowed to call the API with credentials, e.g. https://example.org. Repeatable. Required unless --same-site is set',
            type: 'string',
            array: true,
            default: env.ALLOWED_ORIGINS,
          })
          .option('trust-proxy', {
            desc: 'Trust X-Forwarded-* headers from a reverse proxy',
            type: 'boolean',
            default: false,
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
    .command('experiment', 'Manage experiments', (yargs) =>
      yargs
        .command(
          'add <name>',
          'Create an experiment',
          (yargs) =>
            yargs
              .positional('name', {
                desc: 'Experiment name',
                type: 'string',
                demandOption: true,
              })
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
          (argv) => addExperiment(argv).catch(handleError),
        )
        .demandCommand(1)
        .strict()
        .help()
        .alias('help', 'h'),
    )
    .command(
      'export',
      'Export logs',
      (yargs) => {
        return yargs
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
          .option('logType', { alias: 't', type: 'string' })
          .option('experimentName', { alias: 'e', type: 'string' })
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
    .strict()
    .parse();
}

function handleError(error: unknown) {
  log.error(error);
  process.exit(1);
}

if (import.meta.main) {
  cli();
}
