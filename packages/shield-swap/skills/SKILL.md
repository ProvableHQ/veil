---
name: shield-swap-trader
description: >
  Trade on Shield Swap, the private AMM DEX on Aleo testnet — set up an
  account and get tokens, discover pools, make private swaps (including
  several at once), provide and withdraw liquidity, and collect swap
  outputs and LP earnings. Use when the user asks to set up a shield-swap
  account, get an airdrop, swap tokens, mint/add/remove liquidity
  positions, or collect winnings.
---

# Trading on Shield Swap

Shield Swap is a concentrated-liquidity AMM on Aleo testnet
(`shield_swap_v3.aleo`). This skill drives it end-to-end with
`@provablehq/shield-swap-sdk`. Everything here works the same for any agent:
the runbooks are plain markdown, the scripts run with `npx tsx`.

## The one rule that prevents lost funds

A private swap pays out to a single-use blinded address, and the
`SwapHandle` returned by `swap()` is the ONLY key to claiming that money.
Persist every handle to the state file the moment a swap returns, before
doing anything else. The same goes for `positionTokenId` after minting
liquidity. The session helpers do this — use them.

## Session model

All long-lived material lives in `./.shield-swap/state.json` (private key,
Provable API credentials, DEX API token, open swap handles, position ids).
It is created by the setup script with mode 0600. NEVER commit it — add
`.shield-swap/` to `.gitignore`. `scripts/session.ts` owns reading and
writing it; every snippet in these runbooks starts from its `loadSession()`.

Scripts run from this directory (call it `$SKILLS` below):

- in the Veil repo: `$SKILLS = packages/shield-swap/skills` — run
  `pnpm install && pnpm build` once first
- from npm: `$SKILLS = node_modules/@provablehq/shield-swap-sdk/skills` —
  run `npm install @provablehq/shield-swap-sdk @provablehq/veil-aleo-sdk tsx`
  once first

Write scratch scripts as `.mts` files (ESM — plain `.ts` may be treated as
CommonJS outside the repo and reject top-level `await`), import the session
helpers from `$SKILLS/scripts/session.js`, and run them with `npx tsx`.

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
what they want to do — never launch into a journey unprompted. Offer three
paths:

1. **Their own playbook.** Ask whether they have a markdown file, notes, or
   a memory store (an Obsidian vault, a strategy doc, instructions from a
   previous session) they want followed. If so, read it and treat it as the
   plan — the runbooks below are the how, their document is the what.
2. **A suggested journey.** Offer the table below verbatim-ish: swap
   against live pools; make several private swaps at once; open a
   liquidity position; add/remove liquidity; collect winnings.
3. **A free-form prompt.** Whatever they describe, map it onto the
   runbooks before improvising against the SDK.

## Runbooks

| Task | Runbook | User says things like |
| --- | --- | --- |
| Account setup, registration, airdrop | [startup.md](./startup.md) | "set up a shield-swap account and get tokens" |
| Discover pools and swap privately (incl. several at once) | [swapping.md](./swapping.md) | "find pools and start swapping" |
| Mint positions, add/remove liquidity | [liquidity.md](./liquidity.md) | "create a position", "add/remove liquidity" |
| Claim swap outputs, collect LP earnings | [collecting.md](./collecting.md) | "collect my winnings" |

Always run startup first — every other runbook assumes its gates have
passed (key material, API registration, DEX session, invite redemption,
funded account).

## Ground rules for every runbook

- **Discover inputs, never invent them.** Pool keys, token ids, wrapper
  programs, and decimals come from `client.api.getPools()` /
  `getTokens()`; quotes come from `client.api.getRoute()`; live pool state
  comes from `client.getSlot()`. Field literals (`…field`) and addresses
  are opaque — copy them exactly.
- **Amounts are raw base units** (`bigint`, u128). Convert with the token's
  `decimals` from the API: 1 token = `10n ** BigInt(decimals)` units.
- **Tokens arrive and move privately.** The faucet airdrops private
  records, so public balances read zero on a funded account — check
  holdings with the session helper `getHoldings()` (it reads both sides).
  Record selection picks ONE record large enough for the amount; it does
  not aggregate small records.
- **Fees are covered.** Delegated proving through the Provable prover pays
  transaction fees; the account needs no credits.
- **Writes are slow.** A swap or mint takes on the order of a minute or two
  (remote proving + confirmation). Set timeouts accordingly and never
  re-submit just because a call is slow — check the state file and chain
  first.
- **Concurrency is opt-in and has sharp edges.** Concurrent swaps from one
  account MUST partition blinded-identity counters and use disjoint input
  records — the exact recipe is in [swapping.md](./swapping.md). When in
  doubt, run swaps sequentially.
- **One runbook script at a time.** The state file has no lock. Persist
  through the session helpers (`appendSwapHandle`, `removeSwapHandle`,
  `appendPosition` — each re-reads before writing) and do not run two
  runbook scripts concurrently; concurrency belongs INSIDE one script, per
  the swapping recipe.
