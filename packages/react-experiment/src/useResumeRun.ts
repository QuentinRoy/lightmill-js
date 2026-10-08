import * as React from 'react';
import type { ResumeLog } from './logClient.js';

export type ResumeRun = {
  /** Resumes the run. Calling it more than once does nothing. */
  resume: () => void;
  run: { id: string; name: string | null; status: string };
  /** The last resumable log, or `null` when none was logged yet. */
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
