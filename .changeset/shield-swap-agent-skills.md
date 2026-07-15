---
'@provablehq/shield-swap-sdk': minor
'@provablehq/veil-aleo-sdk': minor
---

Agent skills for trading on Shield Swap, and the SDK support they exposed a
need for.

- `@provablehq/shield-swap-sdk` ships agent-agnostic runbooks and an
  idempotent bootstrap under `skills/` (npm-packaged): account setup with
  Provable API self-registration, invite/referral-code redemption, airdrop,
  private swaps (including concurrent), liquidity, and collection.
- New exports: `resolveDexImports` (builds the full imports map a write
  needs, including the DEX program's own static imports),
  `redeemReferralCode` (referral codes unlock access like access codes; the
  agent redeem tool and setup try both), and DEX API auth additions from the
  auth-flow work.
- `@provablehq/veil-aleo-sdk` threads `useFeeMaster` through
  `createProvingConfig`/`createAleoClient` and defaults it to true: the
  delegated prover pays transaction fees, so faucet-funded accounts holding
  no public credits can transact out of the box (pass `useFeeMaster: false`
  when the account funds its own fees).
