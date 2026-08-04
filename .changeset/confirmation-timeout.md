---
'@provablehq/veil-aleo-sdk': minor
---

Expose `confirmationTimeout` on `createAleoClient`.

`createProvingConfig` accepted it but `createAleoClient` did not forward it, so a
caller using the convenience factory was fixed at the default and had to compose the
proving config by hand to change it. Multi-hop swaps exceed that — one
measured at 322 seconds against a 300-second limit, surfacing as a timeout on a
transaction that was still pending and would confirm.
