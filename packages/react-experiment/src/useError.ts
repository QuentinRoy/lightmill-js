import * as React from 'react';
import { timelineContext } from './contexts.js';

export function useError(): Error {
  const state = React.useContext(timelineContext);
  if (state == null) {
    throw new Error(
      'No timeline context found. Is this component rendered in a <Run />?'
    );
  }
  if (state.status !== 'crashed') {
    throw new Error(
      'Timeline did not crash. Is this component rendered in a <Run />?'
    );
  }
  return state.error;
}
