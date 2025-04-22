import * as React from 'react';
import type { RegisteredLog, RegisteredTask } from './config.js';
import type { TimelineState } from './useManagedTimeline.js';

export const timelineContext =
  React.createContext<TimelineState<RegisteredTask> | null>(null);

export const noLoggerSymbol = Symbol('no logger');

export const loggerContext = React.createContext<
  ((log: RegisteredLog) => void) | null | typeof noLoggerSymbol
>(null);
