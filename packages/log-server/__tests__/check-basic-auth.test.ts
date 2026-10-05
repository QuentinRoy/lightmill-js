import { describe, expect, it } from 'vitest';
import { checkBasicAuth } from '../src/utils.ts';

const basic = (credentials: string) =>
  `Basic ${Buffer.from(credentials).toString('base64')}`;

describe('checkBasicAuth', () => {
  it('accepts matching credentials', () => {
    expect(checkBasicAuth(basic('user:pass'), 'user', 'pass')).toBe(true);
  });

  it('accepts a password containing colons', () => {
    expect(checkBasicAuth(basic('user:pa:ss:'), 'user', 'pa:ss:')).toBe(true);
  });

  it('rejects wrong credentials', () => {
    expect(checkBasicAuth(basic('user:nope'), 'user', 'pass')).toBe(false);
    expect(checkBasicAuth(basic('other:pass'), 'user', 'pass')).toBe(false);
    expect(checkBasicAuth(basic('user:pa'), 'user', 'pa:ss')).toBe(false);
  });

  it.each([
    ['missing', undefined],
    ['non-Basic', 'Bearer abc'],
    ['valueless', 'Basic'],
    ['colonless', basic('user')],
  ])('rejects a %s header without throwing', (_, header) => {
    expect(checkBasicAuth(header, 'user', 'pass')).toBe(false);
  });
});
