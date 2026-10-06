import { expectTypeOf, it } from 'vitest';
import { createLogServer } from '../src/app.ts';

type Options = Parameters<typeof createLogServer>[0];
type RequiredOptions = Pick<
  Options,
  'dataStore' | 'sessionKeys' | 'hostPassword'
>;
type IsAllowed<T> = T extends Options ? true : false;

it('allows a dynamic cookie site with default cookie security', () => {
  expectTypeOf<
    IsAllowed<RequiredOptions & { cookieSite: 'same-site' | 'cross-site' }>
  >().toEqualTypeOf<true>();
});

it('rejects insecure cross-site cookies', () => {
  expectTypeOf<
    IsAllowed<RequiredOptions & { secureCookies: 'never' }>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    IsAllowed<
      RequiredOptions & { cookieSite: 'cross-site'; secureCookies: 'never' }
    >
  >().toEqualTypeOf<false>();
});

it('allows any cookie security for same-site cookies', () => {
  expectTypeOf<
    IsAllowed<
      RequiredOptions & { cookieSite: 'same-site'; secureCookies: 'auto' }
    >
  >().toEqualTypeOf<true>();
  expectTypeOf<
    IsAllowed<
      RequiredOptions & { cookieSite: 'same-site'; secureCookies: 'always' }
    >
  >().toEqualTypeOf<true>();
  expectTypeOf<
    IsAllowed<
      RequiredOptions & { cookieSite: 'same-site'; secureCookies: 'never' }
    >
  >().toEqualTypeOf<true>();
});

it('rejects automatic cookie security for cross-site cookies', () => {
  expectTypeOf<
    IsAllowed<
      RequiredOptions & { cookieSite: 'cross-site'; secureCookies: 'auto' }
    >
  >().toEqualTypeOf<false>();
});

it('requires a host password', () => {
  expectTypeOf<
    IsAllowed<Pick<Options, 'dataStore' | 'sessionKeys'>>
  >().toEqualTypeOf<false>();
});
