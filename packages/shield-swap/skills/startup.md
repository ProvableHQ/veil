# Startup: account, registration, airdrop

Goal: a fully provisioned account — key material, Provable API consumer
(proving + record scanning), an authenticated DEX API session, invite-code
access, a long-lived API token, and a funded wallet.

One script does all of it, idempotently. Re-running is always safe: every
step checks before acting, and a run that stopped mid-way resumes where it
left off.

## Procedure

1. If `./.shield-swap/state.json` does not exist, ask the user whether they
   already have a shield-swap account (see SKILL.md — this is mandatory).
2. Run the script for their situation:

```sh
# brand-new account (user confirmed they have none)
npx tsx $SKILLS/scripts/setup.ts --new

# returning user: they save their key to a file THEMSELVES, the path is
# what travels — the key never appears in the conversation or shell history
npx tsx $SKILLS/scripts/setup.ts --private-key-file <path>

# returning user who also has Provable API credentials
npx tsx $SKILLS/scripts/setup.ts --private-key-file <path> --consumer-id <id> --api-key <key>

# when setup asks for an invite code
npx tsx $SKILLS/scripts/setup.ts --invite-code <code>
```

**Private keys never transit the conversation.** When the user has an
existing key, ask them to write it to a file (e.g. `~/.aleo-key`, any
location they choose) and tell you the path — or to export
`SHIELD_SWAP_PRIVATE_KEY` / `SHIELD_SWAP_PRIVATE_KEY_FILE` in their own
shell before you re-run setup. Do not accept a pasted key, and do not echo
one if pasted anyway.

Environment variables work as fallbacks for the other flags too:
`ALEO_CONSUMER_ID`, `ALEO_DPS_API_KEY`, `SHIELD_SWAP_INVITE_CODE`. State
location overrides with `SHIELD_SWAP_STATE_DIR` (default `./.shield-swap`).

## Exit-code contract

| Exit | Marker in output | What to do |
| --- | --- | --- |
| 0 | `Account … is ready` + holdings | Proceed to swapping/liquidity. |
| 2 | `NEEDS_CONFIG_DECISION` | Ask the user: existing account or new? Existing → key goes in a file (`--private-key-file <path>`) or their own env, never pasted. New → `--new`. |
| 2 | `NEEDS_INVITE_CODE` / `INVALID_INVITE_CODE` | Ask the user for their (valid, unused) invite code; re-run with `--invite-code`. |
| 3 | `AIRDROP_PENDING` | The faucet finished but records are still indexing. Wait a few minutes, re-run — it will not double-request. |
| 1 | `SETUP_FAILED: …` | Read the message; usually transient (network) — re-run once before digging. |

## What each gate does

1. **Key material** — reuses the stored key, imports one from
   `--private-key-file` (or the user's own env), or generates one under
   `--new`. The address is derived and stored.
2. **Provable API consumer** — self-registers at
   `https://api.provable.com/consumers` (or adopts imported credentials).
   These credentials authenticate delegated proving and the record scanner.
3. **DEX session** — challenge/verify handshake; the account signs, the
   session lasts ~24h and auto-renews on expiry.
4. **Invite code** — checks `getAccessStatus()`; redeems when a code is
   provided. One-time per account. Without access every gated endpoint
   returns 403.
5. **API token** — mints a long-lived `ss_…` token, stored in the state
   file, so later sessions could skip the handshake if needed.
6. **Airdrop** — when the account holds nothing (public AND private — the
   faucet sends PRIVATE records), requests the testnet faucet, polls the
   job to completion, then polls the record scanner until the records are
   visible. The scanner indexes asynchronously; a few minutes of lag is
   normal.

## Verifying readiness

The final report lists funded tokens with their wrapper programs, e.g.:

```
Account aleo1… is ready:
  ETH: public 0, private 6000000000000000 (test_arc20_eth.aleo)
  wALEO: public 0, private 400000000 (test_arc20_wrapped_credits.aleo)
  wUSDCx: public 0, private 10000000 (test_arc20_wusdcx.aleo)
```

Private balances funded + exit 0 = ready to trade. Note the wrapper
programs — swaps and liquidity operations need them.

## Security notes

- `state.json` holds the private key and API credentials (mode 0600).
  Never commit it, print it, or paste its contents anywhere.
- The invite code is one-time; after redemption it has no further value.
- The `ss_…` API token covers data/trading endpoints for this account —
  treat it like a password.
- One state file per account. Registering a fresh Provable API consumer
  for the same account (e.g. importing the key on a second machine)
  re-binds the record scanner to the new consumer, and sessions still
  using the old credentials start failing with
  `No credentials found for given 'iss'` — re-run setup where that
  happens, or carry the state file over instead of re-importing the key.
