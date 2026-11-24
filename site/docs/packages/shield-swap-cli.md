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

## Version and updates

`shield-swap version` prints the installed version without network access;
`--version` and `-v` are aliases. Check for a newer stable release or update a
global npm installation:

```sh
shield-swap version
shield-swap update --check
shield-swap update
```

Both commands support `--json` and work before account setup. `update` uses
npm's configured registry and leaves an equal or newer installed version in
place. Project installs, linked source checkouts, and other package managers
receive manual update instructions. For a project installed with npm, run
`npm install --save-dev @provablehq/shield-swap-cli@latest` from the project root.
`update --check` works for any installation type with npm on `PATH`.

## Accounts

A saved Aleo account lets Shield Swap commands and Veil scripts use the same
address without supplying its private key on every run. Import an existing key
or recovery phrase to keep using the same account and funds; create a new
account when a separate address is needed.

**Prefer Keychain storage on macOS or encrypted storage.** Keychain keeps the
private key in the macOS Keychain, outside the account file. Encrypted storage
keeps the key in the file but requires a password to unlock it. The default is
plaintext: the file contains a readable private key, and anyone who can read
it can use the account. File permissions do not encrypt copies or backups.

Create a protected account and prepare it for trading:

```sh
shield-swap account create --name trading --storage encrypted
shield-swap setup --name trading
```

For an existing account, use
`shield-swap account import --name trading --key-file key.txt --storage encrypted`
in place of the create command. On macOS, `--storage keychain` is an alternative
to `--storage encrypted`. An import leaves its source file unchanged, so a
readable key in that file still needs protection.

The [account keystore](../api/provable-sdk/accountKeystore.md) saves each account
under `~/.aleo/accounts/<name>.json` by default. An encrypted account can be
restored from that file and its password; a Keychain account also needs a
separate backup of the key or recovery phrase to move to another machine.
Use `shield-swap account show --name trading` to confirm the address and storage.

If the account is already stored in plaintext, change its storage without
changing its address or moving funds:

```sh
shield-swap account protect --name trading --storage encrypted
```

Setup's `--new` and `--private-key-file` options create plaintext account files,
so prefer the protected account workflow above. For a key still in
`state.json`, use `shield-swap account migrate --storage encrypted --remove-legacy-key`
to save it in an encrypted account file and remove the readable source copy.

Encrypted accounts need a password from a hidden prompt, `ALEO_ACCOUNT_PASSWORD`,
or a password saved in the macOS Keychain. Unattended scripts need the variable
or saved password. Commands that display a key or recovery phrase require a
terminal and reject `--json`.

See the
[account reference](https://github.com/ProvableHQ/veil/blob/main/packages/shield-swap-cli/README.md#accounts)
for account selection, key lookup order, password changes, and JSON output.

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
