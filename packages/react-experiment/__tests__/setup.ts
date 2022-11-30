import { afterEach } from 'vitest';
import '@testing-library/jest-dom/extend-expect';
import { cleanup } from '@testing-library/react';

// runs a cleanup after each test case (e.g. clearing jsdom)
afterEach(() => {
  cleanup();
});
