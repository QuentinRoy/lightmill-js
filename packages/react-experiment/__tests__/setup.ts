import * as matchersPkg from '@testing-library/jest-dom/matchers';

const matchers = matchersPkg as (typeof matchersPkg)['default'];

expect.extend(matchers);
