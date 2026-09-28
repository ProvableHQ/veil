---
"@provablehq/shield-swap-sdk": minor
"@provablehq/shield-swap-cli": patch
---

Add `quote` and `swap({ quote })` for API-estimated single- and multi-hop swaps. Preserve the exact quoted minimum output, validate route/network/freshness, and expose the handoff through agent/MCP tools and the CLI. Keep existing manual swap and `planSwap` calls compatible.

Make the existing `client.api.confirmAirdrop` also wait for the faucet transaction records when the outer client has a record scanner; retain job-only confirmation without one.
