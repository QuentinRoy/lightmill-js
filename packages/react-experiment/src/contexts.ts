import * as React from 'react';
import type { RegisteredLog, RegisteredTask } from './config.js';
import type { PlayerTaskState } from './playerState.js';

export const taskContext =
  React.createContext<PlayerTaskState<RegisteredTask> | null>(null);

export const noLoggerSymbol = Symbol('no logger');

export const loggerContext = React.createContext<
  ((log: RegisteredLog) => void) | null | typeof noLoggerSymbol
>(null);
