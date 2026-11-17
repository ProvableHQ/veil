# @provablehq/shield-swap-cli

[All Veil packages](../../README.md#packages) · [Documentation](https://provablehq.github.io/veil/packages/shield-swap-cli) · [npm](https://www.npmjs.com/package/@provablehq/shield-swap-cli) · [LLM index](../../llms.txt)

The `shield-swap` command: trade on Shield Swap from a terminal. Each subcommand
does one job against a live deployment — builds a session, plans the work,
prints what happened.

This is a separate install from `@provablehq/shield-swap-sdk`, so a project that
only needs the client never pulls the command line in. Install it, then call it by
name:

```sh
npm install -g @provablehq/shield-swap-cli

shield-swap pools
shield-swap swap --from USDCx --to ETH --amount 1.5 --execute
```

Or keep it in the project and go through the local bin:

```sh
npm install --save-dev @provablehq/shield-swap-cli

npx shield-swap setup --new
npx shield-swap pools
```

`npx shield-swap` runs the binary that is installed. `npx @provablehq/shield-swap-cli`
names the package instead, which sends npx to the registry: the version can change
between two commands in the same session, and it does not work offline. Prefer the
install.

`shield-swap` on its own lists the subcommands, and every subcommand takes
`--help` for its own flags.

## Running it from the Veil repo

No build step. `tsx` honours the root tsconfig's `paths`, so the SDK resolves
straight to source and every run picks up edits immediately:

```sh
pnpm install
pnpm shield-swap pools
pnpm shield-swap swap --from USDCx --to ETH --amount 1.5
```

Use `pnpm -s` when parsing the output. `pnpm run` prints a two-line banner on
stdout, which is harmless for a person and fatal for `--json`:

```sh
pnpm -s shield-swap balances --json
```

Or skip the wrapper and call it directly, which has no banner:

```sh
npx tsx packages/shield-swap-cli/src/index.ts balances --json
```

To exercise the built binary as a user would get it — the shebang, the lazy
command loading, the `bin` wiring — build the package and run `dist`:

```sh
pnpm --filter @provablehq/shield-swap-cli build
node packages/shield-swap-cli/dist/index.js pools
```

`pnpm --filter @provablehq/shield-swap-cli test:package` builds the CLI and
checks its command help and SQLite storage export. Requires Node 22.13+.

State lands in `./.shield-swap/<network>/` relative to the working directory, so
running from the repo root keeps a session there. Set `SHIELD_SWAP_STATE_DIR` to
point somewhere else — worth doing if you want a scratch account separate from
the one you normally trade with. The private key is not part of that state: see
[Accounts](#accounts).

To drive the SDK directly while sharing the same state file the command line
writes, import the session helpers:

```ts
import { loadSession, formatAmount } from '@provablehq/shield-swap-cli/session'
```

Freezelist witnesses are generated automatically when a write executes. The
session's SDK generator checks the current on-chain root and reuses witnesses
while that root is unchanged. Dry runs do not generate proofs or submit. Custom
deployments can configure `shieldSwapActions({ freezelists })` in the session;
see the [proof configuration](../shield-swap/README.md#freezelist-proofs).

## Two rules that hold everywhere

**Nothing spends until you pass `--execute`.** Every write command plans the
transaction against live chain state, prints exactly what it would do, and stops.
The dry run and the real run differ only in whether a transaction follows, so a
first run is always safe and always worth doing.

**Mainnet is never implicit.** The default network is testnet. Mainnet needs
`--network mainnet` on every invocation (or `SHIELD_SWAP_NETWORK=mainnet` in the
environment), because everything downstream is per-network — the DEX API host, the
prover, the record scanner, the token registry, and the blinded identity store —
and the mainnet ones move real value. When a plan is for mainnet, the banner above
it says so.

Amounts you type are human units (`--amount 1.5`), amounts you read are rendered
with each token's decimals, and raw base units stay inside the SDK where they
belong. `--json` prints one machine-readable object and silences everything else,
so an agent or a pipeline can drive the same command a person uses.

## What each command needs

Every trading command loads the session from `./.shield-swap/<network>/state.json`
and the signing key from the [account](#accounts) that file records, which
means all of them need `setup` to have run once. "Funds" below means a private
balance: private records are what pay for trades and deposits, and a public
balance cannot be traded from. Transaction fees are paid by the delegated prover's
FeeMaster account by default, so a faucet-funded account needs no public credits
(set `SHIELD_SWAP_FEE_MASTER=0` when the account should pay its own).

| Command | What it does | Needs |
| --- | --- | --- |
| `account` | Creates, imports, shows, protects, exports, or migrates the stored Aleo account. Contacts no network. | Nothing |
| `setup` | Sets up all credentials Shield Swap requires, idempotently: the account, DEX authentication, Provable API credentials, invite-code redemption, API token, testnet airdrop. | Nothing (an invite code when access is locked; a key file for a returning account) |
| `redeem` | Redeems a referral code, or gets/creates the account's shareable code with `--generate`. | Session; referral code when redeeming |
| `pools` | Lists pools from the API and joins each with chain state, so the tradeable flag and the depth come from the mappings rather than the index. | Session |
| `balances` | Private and public holdings per token, reconciled against the registry. | Session, record access |
| `inventory` | Inspect, plan, rebalance, or maintain spendable records; report pending operations. | Account, record access, Node 22.13+ |
| `positions` | Every liquidity position the account holds, with its range, its backing amounts, and the fees earned that a collect would pay. | Session, record access |
| `swap` | Sells one token for another, single hop or routed, then claims the output. | Funds in the token being sold |
| `swap-concurrent` | Makes multiple swaps concurrently, one per token sold, planned before any is submitted. | Funds in each token being sold |
| `history` | Swap history and the status of each swap, claiming what is still waiting; rebuilds a lost identity store from chain history. | Session (claiming needs the prover) |
| `mint` | Opens a position: aligns a percentage range to the pool's tick spacing and deposits what the range consumes. | Funds on **both** sides of the pool |
| `liquidity` | Adds to an open position, or removes liquidity and books it as owed. | A position; funds on both sides to add |
| `collect` | Sweeps what a position is owed into records, and with `--close` burns the drained position. | A position with something owed |
| `liquidity-e2e` | The whole lifecycle in one run — mint, increase, decrease, collect, burn — with the waits each step needs. | Funds on both sides of the pool |

"Record access" means the hosted record scanner, which `setup` configures with
the Provable API credentials it registers. Reads that touch only mappings
(`pools`) work without it.

## Accounts

The private key is not kept in the state directory. `shield-swap` finds it
through the [account keystore](../provable-sdk/README.md#account-keystore) of
`@provablehq/veil-aleo-sdk/node`, so the command line and a script built on
that SDK share one account. Every command that signs resolves the key in this
order:

1. `ALEO_PRIVATE_KEY`, then its alias `SHIELD_SWAP_PRIVATE_KEY`.
2. The file named by `ALEO_PRIVATE_KEY_FILE`, then its alias
   `SHIELD_SWAP_PRIVATE_KEY_FILE`: a text file holding only the key.
3. The account file, `~/.aleo/accounts/<name>.json`. `ALEO_ACCOUNTS_DIR` names
   another directory.
4. A key still held by a `state.json` that an earlier version wrote.

A key from the environment is used for that run and is never written to disk.
A variable that is set but empty is an error, and so are two variables that
hold different keys. The resolved key MUST derive the address recorded in
`state.json`: a mismatch stops the command and names both addresses.

The account name comes from `--name` (on `setup` and `shield-swap account`),
then `ALEO_ACCOUNT`, then the name recorded in `state.json`, then `default`. An
account file is not tied to a network, so one account can serve testnet and
mainnet; named accounts keep them apart. A second account uses a second state
directory (`SHIELD_SWAP_STATE_DIR`).

`setup --new` generates an account and stores it in the account file, and
`setup --private-key-file <path>` stores the key of that file there. Both write
plaintext storage: a file only its owner can read. `setup` stops with
`NEEDS_CONFIG_DECISION` (exit 2) when it finds no key and `--new` is absent.

### `shield-swap account`

```sh
shield-swap account create                        # Generate and store an account.
shield-swap account create --mnemonic             # Generate an account and display its recovery phrase.
shield-swap account import --key-file key.txt     # Import a private key.
shield-swap account import --mnemonic-file phrase.txt --index 0
shield-swap account show --json                   # Inspect account details without displaying the key.
shield-swap account protect --storage encrypted   # Encrypt the stored key with a password.
shield-swap account export                        # Display the key after terminal confirmation.
shield-swap account migrate --remove-legacy-key   # Migrate the key and remove it from state.json.
```

| Command | Effect |
| --- | --- |
| `create` | Generates a key and stores it. With `--mnemonic`, the key is the first account of a new 12-word recovery phrase on the standard path; the phrase is printed once and stored nowhere. |
| `import` | Stores an existing key. Sources, in order: `--key-file` or `--mnemonic-file`, then the key variables above, then a hidden prompt. Text from the prompt that starts with `APrivateKey1` is a key; anything else is taken as a recovery phrase. Only the derived key is stored, never the phrase. |
| `show` | Prints the address, the account name, the storage type and the path. Reads only the account file. |
| `protect` | Changes how the key is stored. Requires `--storage`, unless `--forget-password` is given alone. |
| `export` | Prints the private key after a confirmation. |
| `migrate` | Copies the key of a legacy `state.json` or `profile.json` into an account file. |

| Flag | Commands | Meaning |
| --- | --- | --- |
| `--name <name>` | all | Account name. Defaults to `ALEO_ACCOUNT`, then `default`. |
| `--dir <path>` | all | Accounts directory. Defaults to `ALEO_ACCOUNTS_DIR`, then `~/.aleo/accounts`. |
| `--json` | all | One machine-readable object on standard output. |
| `--storage <type>` | `create`, `import`, `protect`, `migrate` | `plaintext` (the default), `keychain` (macOS) or `encrypted`; `none` on `create` and `import` only, which records the address without the key. |
| `--save-password` | `create`, `import`, `protect`, `migrate` | Also saves the password of an encrypted account in the macOS Keychain. |
| `--forget-password` | `protect` | Removes a saved password from the macOS Keychain. |
| `--mnemonic` | `create` | Derives the key from a new recovery phrase. |
| `--key-file <path>` | `import` | Text file holding the key. |
| `--mnemonic-file <path>` | `import` | Text file holding a recovery phrase. |
| `--index <n>` | `import` | Account index for a phrase. Defaults to 0. |
| `--derivation <id>` | `import` | `standard` (the default) or `legacy`. |
| `--from <path>` | `migrate` | The legacy file. Defaults to the `state.json` of the selected network. |
| `--network <network>` | `migrate` | Selects that `state.json`: `testnet` (the default) or `mainnet`. |
| `--remove-legacy-key` | `migrate` | Strips the key from the legacy file after the new account file is read back. |

The password of an encrypted account is never a command-line argument. It
comes from `ALEO_ACCOUNT_PASSWORD`, a password saved in the macOS Keychain, or
a hidden prompt. An unattended job needs the variable or the saved password,
since it cannot answer a prompt.

`export`, `create --storage none` and `create --mnemonic` show a secret. They
run only with a terminal on standard input, output and error, and they refuse
`--json`, both with `TERMINAL_REQUIRED`. An agent MUST NOT run them. Plain
`create` prints nothing secret and works without a terminal.

`protect --storage encrypted` on an account that is already encrypted sets a
new password, taken from the prompt only. `protect --forget-password` alone
removes the saved password and keeps the password itself. The keystore drops a
saved password by encrypting the account again, so the command needs the
current password, from `ALEO_ACCOUNT_PASSWORD` or a hidden prompt, and the
account file gets a new salt. After a change to `keychain` or `encrypted`,
`protect` warns when a plaintext copy of the same key remains in the current
state directory or in `~/.shield-swap/profile.json`. It reads those files and
changes nothing; state kept in other directories is not checked.

When the migrated file is one of this command line's own state files, `migrate`
also records the account name in it. Without `--remove-legacy-key` the legacy
file keeps its key, and the command says so.

Output and exit codes:

- A result is one line for a person, or with `--json` the object
  `{"name":…,"address":…,"storage":…,"path":…}`.
- An error is `<CODE>: <message>` on standard error, or with `--json` the
  object `{"error":{"code":…,"message":…}}` on standard output. The codes are
  those of the keystore's `KeystoreError`.
- Exit 0 means done and 1 means failed. Exit 2 means a person is needed:
  `ACCOUNT_NOT_FOUND`, `KEY_NOT_STORED`, `PASSWORD_REQUIRED` or
  `TERMINAL_REQUIRED`. Exit 64 is a usage error, reported with the usage text
  on standard error.

### State written by an earlier version

A `state.json` that already holds a `privateKey` keeps working with no action.
Each run that reads the key from it prints one line on standard error pointing
at `shield-swap account migrate`. To move the key into an account file and
strip it from the state:

```sh
shield-swap account migrate --remove-legacy-key
shield-swap account migrate --network mainnet --name mainnet --remove-legacy-key
```

Three behaviours differ from earlier versions:

- A key supplied through `SHIELD_SWAP_PRIVATE_KEY` or
  `SHIELD_SWAP_PRIVATE_KEY_FILE` is no longer copied into `state.json`. A setup
  that relied on the copy needs the variable on every run, or one
  `shield-swap account import` to store the key.
- The variable now comes before the key file. With both set to different keys
  the command stops instead of picking one.
- A `state.json` written by this version holds no `privateKey`, so an earlier
  version of the command reports no session for it.

## Redeeming or generating a referral code

For an account already saved by `setup`, preview and redeem a referral code:

```sh
shield-swap redeem --code REF123
shield-swap redeem --code REF123 --execute
shield-swap redeem --network mainnet --code REF123 --execute --json
```

`--code` is required for redemption. Redemption authenticates with the saved account, unlocks
the gated DEX API endpoints, and records access in that network's state file.
It spends no funds and requests no airdrop. The API reports invalid or already-used
codes as errors. Without `--execute`, the command only previews the account and
code; it does not check whether the code is valid.

If `setup` stopped because an invite code was missing, it has already saved the
account. Run `redeem` to unlock access, then re-run `setup` to finish the remaining
setup steps.

To generate a code to share, use `--generate` instead of `--code`:

```sh
shield-swap redeem --generate
shield-swap redeem --generate --execute --json
```

The server creates a personal code when issuance is enabled, or returns the
account's existing code. Generation requires `--execute` and does not redeem a
code or change the account's access grant. `--generate` and `--code` MUST NOT be
combined. If no code can be issued, the command reports an error.

## A suggested order

1. **`shield-swap setup --new`** — once. It stores a new account, ends by
   telling you the account is ready, and on testnet it draws funds and waits
   for the records to land.
2. **`shield-swap balances`** — confirm what arrived. Nothing below works until
   this shows a private balance.
3. **`shield-swap pools`** — see what can be traded and how deep it is. Note the
   pool keys and symbols you care about.
4. **`shield-swap swap --from … --to … --amount …`** — no `--execute` first, then
   with it. A swap is two transactions and this does both, so the proceeds arrive
   in the same run.
5. **`shield-swap history`** — after any trading session. It reads the chain
   rather than local bookkeeping, so an entry appears exactly when a claim would
   succeed.
6. **`shield-swap mint --pair … --percent …`** — become the market instead of
   trading against it. Read the plan carefully: the range, and how much of each
   side the range actually consumes.
7. **`shield-swap positions`** — watch what the position holds and earns.
8. **`shield-swap liquidity --position … --increase|--decrease`** — top it up, or
   take part of it back out. A decrease books the proceeds; it does not pay them
   out.
9. **`shield-swap collect`** — sweep the earnings, and `--close` to burn a
   position you are finished with.

`shield-swap liquidity-e2e` walks steps 6 through 9 in one go. It is the fastest
way to prove a funded account works end to end against a live deployment, and the
place to look for how the waiting between dependent transactions has to be done.

## Two kinds of lag worth knowing about

Both bite when one transaction is built from the result of the last one, which is
most of the liquidity flow.

Mapping writes propagate to reads asynchronously, so a read taken straight after a
confirmed transaction can still show the previous state. Every command that needs
its own write back polls for it.

The record scanner lags further, and its failure mode is quieter. Each liquidity
write spends the position record and issues a new one; a transaction built on the
spent record carries a serial number the chain has already consumed, so the node
drops it at verification. It never reaches a block, and the only symptom is a
confirmation wait against a transaction nothing has heard of. Checking that a
record exists is not enough — the spent one satisfies that too — so the commands
wait for the record's tag to change.

## Keeping state safe

`./.shield-swap/<network>/state.json` holds the account's address, the name of
its account file and the DEX credentials, written with mode 0600. Add
`.shield-swap/` to `.gitignore` all the same: the API token is a credential, and
a state file from an earlier version still holds a private key until
`shield-swap account migrate --remove-legacy-key` strips it. Set
`SHIELD_SWAP_STATE_DIR` to keep the state somewhere else.

The key itself is in the account file, `~/.aleo/accounts/<name>.json`, which
only its owner can read. `shield-swap account protect` moves it into the macOS
Keychain or encrypts it under a password. Either protects a copied file, a
backup or a synced folder. Neither stops a process running as the same user.

The state is not shared between testnet and mainnet — not the API grant, and
above all not the blinded identity store, whose reservations are only meaningful
against the chain they were checked on.

`swap` and `swap-concurrent` obtain API-backed quotes and pass them directly to
execution. The printed minimum is the submitted minimum, for 1–3-hop routes.
Missing output estimates and expired quotes fail before submission; rerun to
obtain fresh terms. Quote lifetime is 60 seconds from the request start.

### Freezelist proofs

The CLI signs locally and cannot resolve wallet-derived freezelist requests.
SDK applications using a connected wallet can opt in with
[`walletFreezelistProofProvider`](../shield-swap/README.md#wallet-derived-freezelist-proofs).
Existing CLI commands keep literal proof behavior. Populated compliance lists
require a concrete proof provider in a customized SDK client; the all-zero
legacy witness is not a general exclusion proof. Collection forwards the
position's withdrawal address as the proof subject.

## Record inventory management

`shield-swap inventory` inspects records, plans joins and splits, and maintains
record counts and amounts for native credits, ARC20, ARC22, or custom assets.
It finds the key as every command does (see [Accounts](#accounts)), after the
variable named by `privateKeyEnv`. These commands require Node 22.13+ and do not
need DEX authentication.

```sh
shield-swap inventory inspect --asset credits.aleo
shield-swap inventory plan --asset credits.aleo --records 4 --json
shield-swap inventory rebalance --asset credits.aleo --records 4 --execute
shield-swap inventory run --config inventory.json --execute
shield-swap inventory status --json
```

`rebalance` and `run` only print plans without `--execute`. See the
[inventory configuration and recovery reference](INVENTORY.md) for policies,
fee limits, and continuous operation, and the
[record inventory guide](../../site/docs/guides/record-inventory.md) for SDK use.

Set `VEIL_INVENTORY_DB` to the journal path used by `shield-swap inventory run`
so trading and maintenance cannot reserve the same explicit record inputs.
The trading session enables `recordManagement: { enabled: true, store, chainId }`
when it creates the client. The SQLite store is also available to applications
from `@provablehq/shield-swap-cli/storage`. Automatic swap selection then tries
another covering record if maintenance reserves its first choice before proving.
The `swap-concurrent` command retains its one-leg-per-input-token limit; SDK
scripts can submit same-token swaps with enough covering records and a shared
blinded identity store.

Without the environment variable, trading commands keep record coordination
disabled and open no inventory journal. Inventory commands explicitly enable
coordination and default to `.veil/inventory.sqlite`. Keep this file across
restarts so pending transactions can be reconciled.
