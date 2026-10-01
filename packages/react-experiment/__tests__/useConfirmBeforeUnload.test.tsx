import { renderHook } from '@testing-library/react';
import { useConfirmBeforeUnload } from '../src/main.js';

function isPrevented() {
  const event = new Event('beforeunload', { cancelable: true });
  globalThis.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('useConfirmBeforeUnload', () => {
  it('asks for confirmation only while enabled', () => {
    const { rerender } = renderHook(
      ({ enabled }) => useConfirmBeforeUnload(enabled),
      { initialProps: { enabled: false } },
    );
    expect(isPrevented()).toBe(false);
    rerender({ enabled: true });
    expect(isPrevented()).toBe(true);
    rerender({ enabled: false });
    expect(isPrevented()).toBe(false);
  });

  it('stops asking once unmounted', () => {
    const { unmount } = renderHook(() => useConfirmBeforeUnload(true));
    expect(isPrevented()).toBe(true);
    unmount();
    expect(isPrevented()).toBe(false);
  });
});
