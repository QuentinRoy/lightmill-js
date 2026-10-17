import * as React from 'react';

export type RunError = {
  /** The thrown value, unchanged. */
  error: unknown;
};

export const runErrorContext = React.createContext<{
  error: unknown;
  experimentName: string;
  runName: string;
} | null>(null);

/**
 * Why the run failed. Only works in `elements.error` of a `Run`.
 */
export function useRunError(): RunError {
  const value = React.useContext(runErrorContext);
  if (value == null) {
    throw new Error('useRunError must be used in elements.error of a <Run />');
  }
  const { error } = value;
  return React.useMemo(() => ({ error }), [error]);
}
