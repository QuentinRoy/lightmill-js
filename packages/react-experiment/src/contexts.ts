import * as React from 'react';
import { RegisteredLog, RegisteredTask } from './config.js';
import { TimelineState } from './timeline.js';

export const timelineContext =
  React.createContext<TimelineState<RegisteredTask> | null>(null);
export const loggerContext = React.createContext<
  ((log: RegisteredLog) => void) | null
>(null);
