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

## Record inventory

Private balances consist of individually spendable records. A trade needs a
record large enough for its input amount; concurrent trades need separate
records. Use `shield-swap inventory` to inspect those records and plan joins or
splits before trading. It supports native credits, ARC20, ARC22, and compatible
custom assets, and requires Node 22.13+ for its SQLite journal. SDK packages
retain their existing runtime support.

Inventory commands use the saved Shield Swap account or a key supplied through
the environment. They do not require DEX authentication. Start by inspecting
the account's credits and previewing a plan for four records:

```sh
shield-swap inventory inspect --asset credits.aleo
shield-swap inventory plan --asset credits.aleo --records 4
```

To submit the joins and splits, run `rebalance` with `--execute`. Without that
flag, it prints a plan without signing:

```sh
shield-swap inventory rebalance --asset credits.aleo --records 4 --execute
```

For ongoing maintenance, define target counts and budgets in an `inventory.json`
policy file, then run:

```sh
shield-swap inventory run --config inventory.json --execute
shield-swap inventory status --config inventory.json
```

`run` also requires `--execute` to submit transactions. The loop runs in the
foreground; use a service manager for background operation. `--json` returns
one object for individual commands. A continuous `run --execute --json` prints
its summary on shutdown.

To share reservations between maintenance and participating trading commands,
set `VEIL_INVENTORY_DB` to the same SQLite journal path and select the same
network. Trading coordination remains off unless that variable is set. Keep
the journal across restarts so pending transactions can be reconciled.

See the [configuration and recovery reference](https://github.com/ProvableHQ/veil/blob/main/packages/shield-swap-cli/INVENTORY.md)
for a complete policy file, account settings, and interruption handling. For
client configuration and SDK examples, see the
[record management guide](../guides/record-inventory.md).
