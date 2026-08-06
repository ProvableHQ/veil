# @provablehq/shield-swap-cli

The `shield-swap` command: trade on Shield Swap from a terminal. Each subcommand
does one job against a live deployment — builds a session, plans the work,
prints what happened.

This is a separate install from `@provablehq/shield-swap-sdk`, so a project that
only needs the client never pulls the command line in. Run it without installing
anything permanently:

```sh
npx @provablehq/shield-swap-cli setup --new
npx @provablehq/shield-swap-cli pools
```

or install it once and call it by name:

```sh
npm install -g @provablehq/shield-swap-cli

shield-swap pools
shield-swap swap --from USDCx --to ETH --amount 1.5 --execute
```

`shield-swap` on its own lists the subcommands, and every subcommand takes
`--help` for its own flags. In the Veil repo, `pnpm install && pnpm build`, then
run `node packages/shield-swap-cli/dist/index.js <command>`.

To drive the SDK directly while sharing the same state file the command line
writes, import the session helpers:

```ts
import { loadSession, formatAmount } from '@provablehq/shield-swap-cli/session'
```

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

Every command loads the session from `./.shield-swap/<network>/state.json`, which
means all of them need `setup` to have run once. "Funds" below means a private
balance: private records are what pay for trades and deposits, and a public
balance cannot be traded from. Transaction fees are paid by the delegated prover's
FeeMaster account by default, so a faucet-funded account needs no public credits
(set `SHIELD_SWAP_FEE_MASTER=0` when the account should pay its own).

| Command | What it does | Needs |
| --- | --- | --- |
| `setup` | Account bootstrap, idempotent: key material, DEX authentication, Provable API credentials, invite-code redemption, API token, testnet airdrop. | Nothing (an invite code when access is locked; a key file for a returning account) |
| `pools` | Lists pools from the API and joins each with chain state, so the tradeable flag and the depth come from the mappings rather than the index. | Session |
| `balances` | Private and public holdings per token, reconciled against the registry. | Session, record access |
| `positions` | Every liquidity position the account holds, with its range, its backing amounts, and what a collect would pay. | Session, record access |
| `swap` | Sells one token for another, single hop or routed, then claims the output. | Funds in the token being sold |
| `swap-concurrent` | Several swaps in flight at once, one per token sold, planned before any is submitted. | Funds in each token being sold |
| `history` | What is owed, what settled, and claiming what is still waiting; rebuilds a lost identity store from chain history. | Session (claiming needs the prover) |
| `mint` | Opens a position: aligns a percentage range to the pool's tick spacing and deposits what the range consumes. | Funds on **both** sides of the pool |
| `liquidity` | Adds to an open position, or removes liquidity and books it as owed. | A position; funds on both sides to add |
| `collect` | Sweeps what a position is owed into records, and with `--close` burns the drained position. | A position with something owed |
| `liquidity-e2e` | The whole lifecycle in one run — mint, increase, decrease, collect, burn — with the waits each step needs. | Funds on both sides of the pool |

"Record access" means the hosted record scanner, which `setup` configures with
the Provable API credentials it registers. Reads that touch only mappings
(`pools`) work without it.

## A suggested order

1. **`shield-swap setup --new`** — once. It ends by telling you the account is
   ready, and on testnet it draws funds and waits for the records to land.
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

`./.shield-swap/<network>/state.json` holds the private key and the DEX
credentials, written with mode 0600. Add `.shield-swap/` to `.gitignore` and treat
it like a wallet file. Set `SHIELD_SWAP_STATE_DIR` to keep it somewhere else.

Nothing is shared between testnet and mainnet — not the key, not the API grant,
and above all not the blinded identity store, whose reservations are only
meaningful against the chain they were checked on.
