---
'@provablehq/shield-swap-sdk': patch
---

Document what a `null` `state` means on an owned position.

`getOwnedPositions` and the README described it as a mint still finalizing, which
covers one end of a position's life. The other end behaves the same way and was
undocumented: the record scanner marks records spent on its own schedule, and was
measured still serving a burned position more than four minutes after the burn
confirmed. So a `null` state is equally a position that no longer exists, and a
caller rendering a portfolio should treat it as "not a live position" rather than
as a value still loading.
