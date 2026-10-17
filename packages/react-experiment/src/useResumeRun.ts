import * as React from 'react';
import type { ResumeLog, RunInfo } from './logClient.js';

export type ResumeRun = {
  /** Resumes the run. Calling it more than once does nothing. */
  resume: () => void;
  run: RunInfo;
  /** The last completion log, or `null` when no task was completed yet. */
  lastLog: ResumeLog | null;
};

export const resumeRunContext = React.createContext<ResumeRun | null>(null);

/**
 * The run awaiting confirmation. Only works in `elements.resume` of a `Run`.
 */
export function useResumeRun(): ResumeRun {
  const value = React.useContext(resumeRunContext);
  if (value == null) {
    throw new Error(
      'useResumeRun must be used in elements.resume of a <Run />',
    );
  }
  return value;
}
