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
    IsAllowed<RequiredOptions & { secureCookies: false }>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    IsAllowed<
      RequiredOptions & { cookieSite: 'cross-site'; secureCookies: false }
    >
  >().toEqualTypeOf<false>();
});

it('allows forced cookie security for same-site cookies', () => {
  expectTypeOf<
    IsAllowed<
      RequiredOptions & { cookieSite: 'same-site'; secureCookies: true }
    >
  >().toEqualTypeOf<true>();
  expectTypeOf<
    IsAllowed<
      RequiredOptions & { cookieSite: 'same-site'; secureCookies: false }
    >
  >().toEqualTypeOf<true>();
});

it('requires a host password', () => {
  expectTypeOf<
    IsAllowed<Pick<Options, 'dataStore' | 'sessionKeys'>>
  >().toEqualTypeOf<false>();
});
