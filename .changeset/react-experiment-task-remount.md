---
'@lightmill/react-experiment': major
---

`TimelinePlayer` mounts each task fresh. Consecutive tasks rendering the same component used to share it, so state, refs, and mount effects carried over from one task to the next. A trial could inherit the previous trial's answer or start time without any error. To share state between tasks, keep it above `TimelinePlayer`, in a parent component (`useState`, `useRef`, or context) or in a store outside React, and have tasks read and write it.
