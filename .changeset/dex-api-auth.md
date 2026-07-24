---
"@provablehq/shield-swap-sdk": patch
---

Fix `ApiClient.authenticate()` for the DEX API's new auth contract: verify now sends `challenge_id` and signs the server-provided challenge message, and the session JWT is read from the `ss_access` cookie (with a body-token fallback for older servers). Redeem endpoints no longer return an upgraded token — the access grant is server-side. Integration tests accept a `VEIL_DEX_API_URL` override for local DEX stacks.
