import * as React from 'react';

/**
 * Asks the browser to confirm before the page is closed or reloaded, for as
 * long as `isEnabled` is `true` and the calling component is mounted.
 */
export function useConfirmBeforeUnload(isEnabled: boolean): void {
  React.useEffect(() => {
    if (!isEnabled) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    globalThis.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      globalThis.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isEnabled]);
}
