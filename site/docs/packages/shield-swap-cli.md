---
title: Shield Swap CLI for Aleo
description: Set up accounts, discover pools, check balances, and trade private tokens or manage liquidity on Aleo with the shield-swap command.
---

# @provablehq/shield-swap-cli

The `shield-swap` command operates the Shield Swap DEX on Aleo. It is a
separate package built on `@provablehq/shield-swap-sdk`, for terminal users
and scripts that need account setup, pool discovery, balances, private swaps,
and liquidity management.

## Installation

```sh
npm install -g @provablehq/shield-swap-cli
shield-swap --help
```

Start with the [trading runbooks](https://github.com/ProvableHQ/veil/blob/main/packages/shield-swap/skills/SKILL.md)
for account setup and the trading flow. The command supports JSON output for
scripts and agents. Fund-moving commands show a plan before execution;
follow the runbook's execution and persistence requirements.

See the [CLI reference and examples](https://github.com/ProvableHQ/veil/blob/main/packages/shield-swap-cli/README.md)
for commands and configuration. For an application that embeds trading,
use the [Shield Swap SDK](./shield-swap) instead.
