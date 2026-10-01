---
'@lightmill/react-experiment': major
---

Remove the `confirmBeforeUnload` prop of `Run`, and add the `useConfirmBeforeUnload(enabled)` hook, which asks the browser to confirm before the page is closed or reloaded for as long as `enabled` is `true` and the calling component is mounted. `Run` could not tell whether logs were still being sent or held, so its prompt could not protect them. Apps now decide when to prompt from what they know, such as the logger's state.

`Run` no longer asks for confirmation by default. To keep a prompt, call the hook from a component that stays mounted, for example `useConfirmBeforeUnload(!timelineCompleted)`, or, with `@lightmill/log-client`, `useConfirmBeforeUnload(!['completed', 'canceled', 'interrupted'].includes(logger.state.status))` to also cover logs still being sent. Remove any `confirmBeforeUnload` prop.
