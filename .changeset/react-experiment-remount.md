---
'@lightmill/react-experiment': minor
---

A remounted `TimelinePlayer` given the same iterator (a generator, a `resumeAfter` result, `array.values()`, an async iterator) now continues where the previous one was, instead of skipping the task in progress or starting over. It shows the task in progress again, with its component state reset, `elements.loading` while the next task loads, or `elements.completed` once the timeline is over, without playing it again. If the timeline ended with an error, it throws that error again until it is given a new iterator. Arrays and other iterables that are not iterators are still played from the start at each mount. `resumeAfterTask` is only read the first time `TimelinePlayer` sees an iterator.
