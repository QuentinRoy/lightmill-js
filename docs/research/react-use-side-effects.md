# How React's `use` and Suspense treat side-effecting promises

Research for bead `lightmill-js-yqf.2` (map #195, feeds #475). Question: starting a run on a log server is a side effect. How does `use()` treat promises created during render, under StrictMode, and when a Suspense boundary re-suspends, and how should a once-only async side effect be read through `use()`?

Sources, pinned:

- react.dev at commit [`046f17d`](https://github.com/reactjs/react.dev/tree/046f17d04295ba047bb5739026b4ac3110f17028) (`src/content/reference/react/*.md`, `src/content/learn/*.md`).
- facebook/react at tag [`v19.3.0`](https://github.com/facebook/react/tree/v19.3.0) (`packages/react-reconciler/src/ReactFiberThenable.js`, `ReactFiberHooks.js`, `ReactFiberWorkLoop.js`) and `CHANGELOG.md` on `main`.
- This repo resolves `react@19.3.0`; `@lightmill/react-experiment` declares `react: ^19.2.0`. Nothing below differs between 19.2 and 19.3 except where noted.

## Answer

React assumes a render is pure and may run it any number of times, then throw the work away. A promise created during render is therefore created again on each attempt, and React reads only one of them. Every other attempt still fires its HTTP request. **A side-effecting promise must be created outside render**: at module level, in an event handler, or in a cache keyed by the run identity. It is then passed down to the component that calls `use`. Neither `useMemo`, `useState` initialisers, `useRef`, nor `cache()` makes creation in render safe.

## Promises created during render

- `use(promise)` requires a cached promise: "Promises passed to `use` must be cached so the same Promise instance is reused across re-renders" ([use.md, Caveats](https://react.dev/reference/react/use#promise-caveats)).
- Why: "React doesn't preserve state for renders that suspended before mounting. After each suspension, React retries rendering from scratch, so any Promise created during render is recreated" ([use.md, "Why are Promises recreated on every render?"](https://react.dev/reference/react/use#why-promises-recreated)). The Suspense caveat says the same ([Suspense.md, Caveats](https://react.dev/reference/react/Suspense#caveats)). A `useRef`, `useState`, or `useMemo` inside a component that suspends before its first mount is discarded with it.
- In source, `use` tracks promises by call index in a per-render `thenableState` (`useThenable`, ReactFiberHooks.js). When a replay passes a different promise at the same index, React keeps the first one and drops the new one: "Reuse the previous thenable, and drop the new one. We can assume they represent the same value, because components are idempotent" (`trackUsedThenable`, ReactFiberThenable.js L139–176). In DEV it logs "A component was suspended by an uncached promise. Creating promises inside a Client Component or hook is not yet supported, except via a Suspense-compatible library or framework." The dropped promise has already run its side effect; React only attaches a no-op handler to silence its rejection.
- `thenableState` survives only replays within one render attempt (`replaySuspendedComponentWithHooks`). It is reset when the component finishes or unwinds to a boundary (`finishRenderingHooks`, `resetHooksOnUnwind`). After unwinding, the retry calls the component from scratch and gets a fresh promise.
- With no `status` field, React instruments the promise itself (`status`, `value`, `reason`). A promise that is already `fulfilled` is read synchronously without suspending ([use.md, "How to implement a promise cache"](https://react.dev/reference/react/use#how-to-implement-a-promise-cache)). React 19.3 adds a DEV warning when `use()` appears to have been skipped conditionally once its promise settled (CHANGELOG 19.3.0, #37104). Always call `use(promise)` rather than reading `promise.status`.
- React 19 "sibling pre-warming": after a fallback commits, React schedules another render of the suspended siblings (CHANGELOG 19.0.0). Render functions can therefore run more often than the visible updates suggest.

## StrictMode

- In development, StrictMode calls component bodies and the functions passed to `useState`, `useMemo`, and `useReducer` twice ([StrictMode.md](https://react.dev/reference/react/StrictMode#fixing-bugs-found-by-double-rendering-in-development)). It also remounts every component once after mount, re-running Effects ([synchronizing-with-effects.md](https://react.dev/learn/synchronizing-with-effects#how-to-handle-the-effect-firing-twice-in-development)).
- Source detail (ReactFiberHooks.js L572–592, `mountMemo`, `mountStateImpl`): in the first invocation, React calls the `useMemo` factory and the `useState` initialiser twice and keeps the first result. The second invocation reuses hook state and the first invocation's promise (`thenableState` is not reset for the StrictMode rerun). So `useMemo(() => client.startRun(...), [])` and `useState(() => client.startRun(...))` still **send two requests** in development, even though the component reads only one promise.
- The React 19 change "`useMemo` and `useCallback` will now reuse the memoized results from the first render, during the second render" (CHANGELOG 19.0.0) means the same value is returned, not that the factory runs once.
- Starting the run in an Effect is also double-fired by StrictMode. A `useRef` guard is discouraged ([synchronizing-with-effects.md, "Don't use refs to prevent Effects from firing"](https://react.dev/learn/synchronizing-with-effects#dont-use-refs-to-prevent-effects-from-firing)), and a non-idempotent POST is "Not an Effect" ([same page](https://react.dev/learn/synchronizing-with-effects#not-an-effect-buying-a-product)).

## Patterns React recommends for a once-only async side effect

1. **Create the promise before rendering and pass it down.** "Ideally, Promises are created before rendering, such as in an event handler, a route loader, or a Server Component, and passed to the component that calls `use`" ([use.md](https://react.dev/reference/react/use#why-promises-recreated)).
2. **Module level, once per app load.** "Some logic should only run once when the application starts. You can put it outside your components" ([synchronizing-with-effects.md, "Not an Effect: Initializing the application"](https://react.dev/learn/synchronizing-with-effects#not-an-effect-initializing-the-application)), or a top-level `didInit` flag ([you-might-not-need-an-effect.md](https://react.dev/learn/you-might-not-need-an-effect#initializing-the-application)). This is what `docs/guides/getting-started.md` ("Wire it together") already does.
3. **Event handler.** Side effects caused by a user action belong in the handler ([synchronizing-with-effects.md, "Buying a product"](https://react.dev/learn/synchronizing-with-effects#not-an-effect-buying-a-product)). Store the promise in state inside `startTransition`, as in [use.md, "Re-fetching data"](https://react.dev/reference/react/use#re-fetching-data-in-client-components). The promise is created once per click; StrictMode does not double-invoke event handlers.
4. **A cache outside React, keyed by identity.** The docs' cache is a module-level `Map` keyed by URL that returns the same promise for the same key ([use.md, "Caching Promises for Client Components"](https://react.dev/reference/react/use#caching-promises-for-client-components)). Calling it in render is fine because the cache, not the component, owns the promise. For a run, the key is the run identity (experiment and run name), and the cache must outlive remounts.
5. **Not `React.cache`.** `cache` "is for use in Server Components only" ([cache.md](https://react.dev/reference/react/cache)).

React offers no hook that runs an async side effect exactly once per mount. The docs treat "how to run once" as the wrong question for Effects ([synchronizing-with-effects.md](https://react.dev/learn/synchronizing-with-effects#how-to-handle-the-effect-firing-twice-in-development)).

## Re-suspending an already visible boundary

- State is kept. Only renders that suspend _before first mount_ lose state ([Suspense.md, Caveats](https://react.dev/reference/react/Suspense#caveats)). When visible content suspends again, React hides it and shows the fallback unless the update is a Transition or `useDeferredValue`. It cleans up layout Effects while hidden and re-fires them when shown. The docs mention only layout Effects; passive `useEffect`s are not documented as torn down.
- The suspending component replays from scratch for that update. Promises created in render are recreated as above. A promise held in already-committed state, a prop, or an external cache is reused.
- Changing a `key` on the boundary or its child remounts it and discards its state ([Suspense.md, "Resetting Suspense boundaries on navigation"](https://react.dev/reference/react/Suspense#resetting-suspense-boundaries-on-navigation)).

## What `useTransition` / `startTransition` changes

- If the update that causes suspension is a Transition, React keeps showing the already revealed content instead of the fallback ([Suspense.md, "Preventing already revealed content from hiding"](https://react.dev/reference/react/Suspense#preventing-already-revealed-content-from-hiding)). `isPending` from `useTransition` signals the wait ([Suspense.md, "Indicating that a Transition is happening"](https://react.dev/reference/react/Suspense#indicating-that-a-transition-is-happening)). New boundaries inside the transition still show their fallback ("A Transition doesn't wait for _all_ content to load").
- In source, a transition that suspends inside the app's shell suspends the work loop and waits for the promise instead of unwinding (`shouldRemainOnPreviousScreen`, ReactFiberWorkLoop.js L2432). On resolution it replays the suspended component with the same `thenableState`, so no fresh render-created promise is made in that path. Retries of already-shown fallbacks also wait instead of unwinding. Sync and default-priority updates unwind to the fallback.
- A Transition does not stop StrictMode double-invocation or remounts. It does not make creating a side-effecting promise in render safe.
- 19.3: "Transitions now render independently instead of being entangled into a single render" (CHANGELOG 19.3.0, #37290). This changes scheduling, not the rules above.

## Implications for lightmill-js

- The guide's module-level `run` promise is the pattern React documents. It is safe under StrictMode, re-suspension, and pre-warming, but it is one run per page load, and the participant comes from the URL.
- A hook such as `useRun(options)` cannot create the run promise in render, even with `useMemo` or `useState`. StrictMode fires two `startRun` requests, and a suspension before mount fires another per retry. A start-or-resume hook (bead `yqf.4`) needs either a cache outside React keyed by run identity, which `use` can read in render, or a promise created by the caller (module level or event handler) and passed in.
- If such a cache is used, an entry for a run that was started must not be evicted while it can still be read. Otherwise a remount starts a second run. A rejected entry should be removable so a retry can start again.
- For `TimelinePlayer` and Suspense (bead `yqf.6`): `usePlayerState` creates its store in a `useRef` during render and starts it in an Effect. If the player suspended before its first mount, that ref would be discarded and a new store built on retry from the same one-shot timeline. This is harmless today: building a store calls `[Symbol.iterator]()` but never `next()` (`TimelineRunner` constructor, `skipThrough`), and a generator's `[Symbol.iterator]()` returns itself. Once mounted, re-suspension keeps the store; pausing via a Transition keeps the task visible instead of showing the fallback.
