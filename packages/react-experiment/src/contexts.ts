import * as React from 'react';
import type { RegisteredLog, RegisteredTask } from './config.js';
import type { TaskResult } from './playerState.js';

export type TaskContextValue = {
  task: RegisteredTask;
  completeTask: (result?: TaskResult) => void;
};

export const taskContext = React.createContext<TaskContextValue | null>(null);

export const noLoggerSymbol = Symbol('no logger');

export const loggerContext = React.createContext<
  ((log: RegisteredLog) => void) | null | typeof noLoggerSymbol
>(null);
