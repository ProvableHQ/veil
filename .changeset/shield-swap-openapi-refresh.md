---
'@provablehq/shield-swap-sdk': patch
---

Refresh the pinned Shield Swap DEX API OpenAPI spec and the generated types from the live `api.testnet.swap.shield.fi` host. The retired invite-code (`/access/*`), `/balances`, `/swaps`, `/tick-spacings`, trading-schema, and token-management routes drop out of the spec; the explore, GeckoTerminal, pool oracle and rebalance-state, route-topology, and referral activity routes join it. Every endpoint the client calls is unchanged. `pnpm regen-openapi` now fetches from the Shield.fi hosts instead of the dead `amm-api.dev.provable.com`, verifies the mainnet spec is a subset of the testnet one, and lists the routes only testnet serves; `airdrop`, `getAirdropStatus`, and `debugPool` are documented as testnet only.
