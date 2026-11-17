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

## Accounts

The command line does not keep the private key in its own state. It finds the
key through the [account keystore](../api/provable-sdk/accountKeystore.md) of
`@provablehq/veil-aleo-sdk/node`, in this order: `ALEO_PRIVATE_KEY`,
`ALEO_PRIVATE_KEY_FILE` (with `SHIELD_SWAP_PRIVATE_KEY` and
`SHIELD_SWAP_PRIVATE_KEY_FILE` as aliases), the account file
`~/.aleo/accounts/<name>.json`, then a key still held by a `state.json` that an
earlier version wrote. A key from the environment is used for that run and is
never written to disk. The state file records the address and the account name,
and the resolved key MUST derive that address.

`shield-swap setup --new` generates an account and stores it in the account
file; `--private-key-file <path>` stores an existing key there; `--name <name>`
selects the account file. `shield-swap account` manages the file without
contacting a network:

```sh
shield-swap account create                        # generate a key and store it
shield-swap account import --key-file key.txt     # store an existing key
shield-swap account show --json                   # address, name, storage; never the key
shield-swap account protect --storage encrypted   # or keychain (macOS), or plaintext
shield-swap account export                        # print the key; terminal only
shield-swap account migrate --remove-legacy-key   # move a key out of state.json
```

Every account command takes `--name`, `--dir` and `--json`. Exit 0 means done,
1 failed, 2 that a person is needed (no account, no stored key, no password, or
no terminal), and 64 a usage error. `export`, `create --storage none` and
`create --mnemonic` show a secret, so they run only at a terminal and refuse
`--json`. See the
[account reference](https://github.com/ProvableHQ/veil/blob/main/packages/shield-swap-cli/README.md#accounts)
for every flag, the output shapes and the migration from earlier state files.

## Record inventory

Private balances consist of individually spendable records. A trade needs a
record large enough for its input amount; concurrent trades need separate
records. Use `shield-swap inventory` to inspect those records and plan joins or
splits before trading. It supports native credits, ARC20, ARC22, and compatible
custom assets, and requires Node 22.13+ for its SQLite journal. SDK packages
retain their existing runtime support.

Inventory commands find the key as every command does (see
[Accounts](#accounts)), after the variable named by `privateKeyEnv`. They do
not require DEX authentication. Start by inspecting
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
