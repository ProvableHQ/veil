---
"@provablehq/shield-swap-cli": minor
"@provablehq/shield-swap-sdk": minor
---

Add `shield-swap redeem --code <code>` to redeem a referral code, or `--generate` to get or create the saved account's shareable code. Preview by default, pass `--execute` to redeem or generate, and use `--network` and `--json` for network selection and machine-readable output.

Expose all non-admin application API endpoints as typed SDK actions and agent/MCP tools, including personal referral codes, referral attribution, analytics, discovery, compliance, price history, and wallet-session management. Add cookie-aware session refresh and explicit logout/revocation, keep admin-only operations excluded, and refresh the generated API types from the deployed specification.
