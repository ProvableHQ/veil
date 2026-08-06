---
name: shield-swap-trader
description: >
  Trade on Shield Swap, the private AMM DEX on Aleo testnet — set up an
  account and get tokens, discover pools, make private swaps (including
  several at once), provide and withdraw liquidity, and collect swap
  outputs and LP earnings. Use when the user asks to set up a shield-swap
  account, get an airdrop, swap tokens, mint/add/remove liquidity
  positions, collect earnings, or develop a trading application or agent
  on Shield Swap.
---

# Trading on Shield Swap

Shield Swap is a concentrated-liquidity AMM on Aleo testnet
(`shield_swap.aleo`). Two packages reach it, installed separately:

- **`@provablehq/shield-swap-sdk`** — the client library. Every DEX action is a
  method on a composed client, and this is what an integration builds on.
- **`@provablehq/shield-swap-cli`** — the `shield-swap` command, built on that
  SDK. Not part of the SDK's install: a project that only needs the client never
  pulls the command line in, and a user who only wants to trade never needs the
  library.

The runbooks are plain markdown and work the same for any agent. Each step is
given as a subcommand, and the SDK call behind it is named so the same step can
be written into an application instead.

## The one rule that prevents lost funds

A private swap pays out to a single-use blinded address, and the blinded
identity behind it is the ONLY key to claiming that money. `swap()` reserves
and records that identity in the SDK's blinded identity store before it
returns, so a crash between the swap and the claim loses nothing — but only
when the store persists. Keep the configured store (the session helpers wire
a file-backed one); never swap with an in-memory store you then discard.

If a store is ever lost, `shield-swap history --reconcile` rebuilds it by
re-deriving identities from the view key and matching them against chain
history. That is a recovery path, not a substitute for keeping the file.

## Session model

All long-lived material lives in `./.shield-swap/<network>/state.json`
(private key, Provable API credentials, DEX API token). It is created by
`shield-swap setup` with mode 0600. NEVER commit it — add `.shield-swap/` to
`.gitignore`. Swap handles and position ids are NOT stored there: handles
live in the SDK's blinded identity store, and positions are discovered from
records with `client.getOwnedPositions()`.

Three ways to run a step. Pick by what the user is doing, not by which is
shortest to type:

- **The command**, for operating the account. `shield-swap <command>` covers
  every standard flow. Add `--json` for one machine-readable object on stdout
  and nothing else, which is what an agent should parse. Nothing spends without
  `--execute`, so always run the plan first and show it to the user.
- **A script sharing the same session**, when a flow needs something the flags
  do not express — an unusual sequence, a loop, a condition. Write it as an
  `.mts` file (ESM — plain `.ts` may be treated as CommonJS outside the repo and
  reject top-level `await`), import `loadSession` from
  `@provablehq/shield-swap-cli/session` so it reads the same state file the
  command writes, and run it with `npx tsx`.
- **An integration**, when the user is building something that outlives the
  session — a dApp, a bot, a server, an agent. It owns its own client and does
  NOT depend on the CLI. Follow [developing.md](./developing.md), which picks the
  packages from where the signing keys live.

### Implementing against the SDK

Every runbook step is one method on a composed client, so a step read here
transfers directly into code. A local-key integration builds the client once:

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { fileCredentialStore } from '@provablehq/veil-aleo-sdk/node'
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'
import { fileBlindedIdentityStore } from '@provablehq/shield-swap-sdk/node'

// The WASM binaries are per network, so the SDK is loaded for one and the
// account, prover, and scanner all come off that handle.
const aleo = await loadNetwork('testnet')
const { walletClient } = aleo.createAleoClient({
  privateKey,
  networkUrl: 'https://api.provable.com/v2',
  provingMode: 'delegated',
  // Credentials reach both the prover and the scanner through one session the
  // client builds from this store, registering a consumer on first use.
  credentialStore: fileCredentialStore('./provable-credentials.json'),
  records: aleo.createRemoteScanner(),
})

const client = walletClient.extend(
  // The identity store MUST persist — see the rule above. A file-backed store is
  // what makes a crash between a swap and its claim recoverable.
  shieldSwapActions({ api: {}, blindedIdentities: fileBlindedIdentityStore('./blinded.json') }),
)
await client.authenticateShieldSwap()
```

In a browser none of that applies: the account and transport come from the
connected wallet through `fromWalletAdapter`, and neither proving nor a scanner
is configured, because the wallet holds the keys and proves. `developing.md` has
the table of which packages go with which key location; the SDK
[README](../README.md) has the per-action reference.

Reads live on the client (`client.getPool`), writes too (`client.swap`), and the
off-chain DEX API is namespaced under `client.api` — so a call site always shows
whether a value came from the chain or from the service.

Install what the path needs: `npm install -g @provablehq/shield-swap-cli` to
operate, `npm install @provablehq/shield-swap-sdk` to build, and both plus `tsx`
for the middle path. In the Veil repo, `pnpm install && pnpm shield-swap
<command>` runs the workspace copy.

## Before doing anything: two questions for the user

1. **Existing account?** If there is no `./.shield-swap/state.json`, ask
   whether the user already has a shield-swap account (a private key, and
   possibly Provable API credentials) before creating anything. The setup
   script enforces this: with no config and no `--new` flag it exits with
   `NEEDS_CONFIG_DECISION`. Never generate a fresh key for a user who may
   already have one — their funds and access live on the old account.
   **NEVER ask the user to paste a private key into the conversation.**
   They supply it out-of-band: saved to a file whose path goes to
   `--private-key-file`, or exported as `SHIELD_SWAP_PRIVATE_KEY` (or
   `SHIELD_SWAP_PRIVATE_KEY_FILE`) in their own shell.
2. **Invite code.** Access to the DEX API is invite-gated per account. When
   setup exits with `NEEDS_INVITE_CODE`, ask the user for their code and
   re-run with `--invite-code <code>`. Do not guess or reuse codes; they are
   one-time.

## After startup: ask what's next

When setup exits 0 (it prints `ASK_NEXT_ACTION`), STOP and ask the user
what they want to do — never launch into a journey unprompted. Present the
options WITH their context so the user understands what each one means,
not just its name:

1. **Their own playbook.** Ask whether they have instructions of their own
   — a markdown strategy file, notes, or a memory store (an Obsidian
   vault, output from a previous session). If so, read it and treat it as
   the plan: their document decides what to do, the runbooks below
   describe how each step works.
2. **A suggested journey.** Keep the descriptions introductory — plain
   language, no implementation detail (identities, records, state files
   are the agent's business, not the user's). Frame the setting first —
   Shield Swap is a private exchange on Aleo's test network: trading uses
   test tokens, and what is traded, and by whom, stays hidden on the
   public chain — then offer:
   - *Swap tokens* — trade one token for another. It settles in two steps
     — placing the trade, then collecting what was bought — and the agent
     does both, so the proceeds arrive without a separate trip. The
     natural first move.
   - *Several swaps at once* — place a handful of trades in parallel and
     watch them all land; the busiest way to exercise the exchange. Before
     running it, show the user which trades are possible right now (one
     per token they hold that has a live pool) and ask how many — and
     which — they want; collect each one as it lands.
   - *Open a liquidity position* — instead of trading, become the market:
     deposit a pair of tokens so other people can trade against them. The
     user picks the price range their deposit works in, and while the
     market price sits inside that range they earn a small cut of every
     trade that passes through.
   - *Add or remove liquidity* — top up a position, or take some of it
     back out; whatever comes out becomes earnings to collect.
   - *Collect earnings* — sweep up everything the account is owed (tokens
     bought in earlier swaps, fees its liquidity earned) into the wallet;
     good to run after any trading session.
3. **Developing a trading application or agent?** Ask whether they are
   building on Shield Swap — a dApp, a trading bot, a server or agent
   integration — rather than (or besides) trading here.
   The chat-driven journeys above are one way to use the DEX; consumers
   also build on the SDK directly — route builders to
   [developing.md](./developing.md), which picks the client by where their
   keys live and maps to the deep docs and examples.
4. **A free-form prompt.** Whatever they describe, map it onto the
   runbooks before improvising against the SDK.

## Runbooks

| Task | Runbook | User says things like |
| --- | --- | --- |
| Account setup, registration, airdrop | [startup.md](./startup.md) | "set up a shield-swap account and get tokens" |
| Discover pools and swap privately (incl. several at once) | [swapping.md](./swapping.md) | "find pools and start swapping" |
| Mint positions, add/remove liquidity | [liquidity.md](./liquidity.md) | "create a position", "add/remove liquidity" |
| Claim swap outputs, collect LP earnings | [collecting.md](./collecting.md) | "collect my earnings" |
| Develop a trading application or agent on Shield Swap | [developing.md](./developing.md) | "I'm building a dApp / trading bot / agent on shield swap" |

Always run startup first — every other runbook assumes its gates have
passed (key material, API registration, DEX session, invite redemption,
funded account).

## Ground rules for every runbook

- **Discover inputs, never invent them.** Pool keys, token ids, wrapper
  programs, and decimals come from `client.api.getPools()` /
  `getTokens()`; quotes come from `client.api.getRoute()`; live pool state
  comes from `client.getSlot()`. Field literals (`…field`) and addresses
  are opaque — copy them exactly.
- **Amounts are raw base units** (`bigint`, u128) on the SDK side. Convert
  with the token's `decimals` from the API: 1 token = `10n ** BigInt(decimals)`
  units.
- **Never show raw units to the user.** Anything user-facing — balances,
  trade sizes, claimed outputs, tables, summaries — MUST be rendered in
  human units with the token symbol via the session helper
  `formatAmount(amount, decimals, symbol)` ("0.0534 ETH", never
  "53,369,000,000,000 raw"). Raw integers misstate holdings by orders of
  magnitude to a human reader.
- **Tokens arrive and move privately.** The faucet airdrops private
  records, so public balances read zero on a funded account — check
  holdings with `client.getBalances()` (it reads both sides).
  Record selection picks ONE record large enough for the amount; it does
  not aggregate small records.
- **Fees are covered.** Delegated proving through the Provable prover pays
  transaction fees; the account needs no credits.
- **Writes are slow.** A swap or mint takes on the order of a minute or two
  (remote proving + confirmation). Set timeouts accordingly and never
  re-submit just because a call is slow — check the state file and chain
  first.
- **Concurrent swaps need disjoint input records.** Blinded identities are
  handled for you: every swap reserves one from the store `loadSession`
  configures, and reservations serialize, so two swaps cannot collide on an
  identity. Records are still yours to keep apart — two swaps selling the same
  token can pick the same record and double-spend it.
- **One runbook script at a time.** The state file has no lock, though there is
  little left in it to race over: swap handles belong to the identity store,
  which serializes its own writes, and positions are discovered from chain
  rather than stored. Still, do not run two
  runbook scripts concurrently; concurrency belongs INSIDE one script, per
  the swapping recipe.
