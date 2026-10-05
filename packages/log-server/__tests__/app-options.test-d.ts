import { expectTypeOf, it } from 'vitest';
import { createLogServer } from '../src/app.ts';

type Options = Parameters<typeof createLogServer>[0];
type RequiredOptions = Pick<Options, 'dataStore' | 'sessionKeys'>;
type IsAllowed<T> = T extends Options ? true : false;

it('allows a dynamic cross-origin setting with default cookie security', () => {
  expectTypeOf<
    IsAllowed<RequiredOptions & { allowCrossOrigin: boolean }>
  >().toEqualTypeOf<true>();
});

it('rejects insecure cross-origin cookies', () => {
  expectTypeOf<
    IsAllowed<RequiredOptions & { secureCookies: false }>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    IsAllowed<
      RequiredOptions & { allowCrossOrigin: true; secureCookies: false }
    >
  >().toEqualTypeOf<false>();
});
