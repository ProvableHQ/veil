---
"@provablehq/shield-swap-sdk": minor
"@provablehq/shield-swap-cli": patch
---

Add `quote` and `swap({ quote })` for API-estimated single- and multi-hop swaps. Preserve the exact quoted minimum output, validate route/network/freshness, and expose the handoff through agent/MCP tools and the CLI. Keep existing manual swap and `planSwap` calls compatible.

Make the existing `client.api.confirmAirdrop` also wait for the faucet transaction records when the outer client has a record scanner; retain job-only confirmation without one.

Accept decimal-string quote inputs in token units, resolving decimals inside quote while retaining bigint raw-unit inputs. The agent/MCP quote tool accepts decimal token amounts and returns raw integer-string quote amounts.
