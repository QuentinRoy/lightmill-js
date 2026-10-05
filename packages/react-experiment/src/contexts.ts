import * as React from 'react';
import type { RegisteredLog, RegisteredTask } from './config.js';
import type { RunTaskState } from './runState.js';

export const taskContext =
  React.createContext<RunTaskState<RegisteredTask> | null>(null);

export const noLoggerSymbol = Symbol('no logger');

export const loggerContext = React.createContext<
  ((log: RegisteredLog) => void) | null | typeof noLoggerSymbol
>(null);
