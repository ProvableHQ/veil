---
"@provablehq/veil-core": minor
---

Add an identifying `X-Veil-Client` header to the `http` transport, sent to Provable-operated hosts only. A new `clientHeader` option replaces the value or disables the header, and the package now exports its `version` constant.
