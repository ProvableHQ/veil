# @provablehq/shield-swap-sdk

## 0.5.0

### Minor Changes

- Agent skills for trading on Shield Swap: agent-agnostic runbooks and an
  idempotent bootstrap ship under `skills/` in the npm package — account
  setup with Provable API self-registration, invite/referral-code
  redemption, airdrop, private swaps (including concurrent), liquidity, and
  collection.
- DEX API auth flows: `authenticateApi()` on the composed client,
  `authenticateWithAccount`, session auto-renewal on 401, long-lived API
  tokens (`createApiToken`/`listApiTokens`/`revokeApiToken`), invite-code
  access (`getAccessStatus`/`redeemAccessCode`) and referral redemption
  (`redeemReferralCode`), plus agent tools for the whole flow.
- `resolveDexImports` builds the full imports map a write needs, including
  the DEX program's own static imports.
- Internal peer ranges widened from `workspace:*` (published as an exact
  pin) to `workspace:^`.

## 0.4.1

### Patch Changes

- c901a27: Add `derivePoolKey` and `deriveTickKey`: derive a pool or tick key locally from `(token0, token1, fee)` or `(pool, tick)` via BHP256 struct hashing, matching the contract byte-for-byte (the pool pair is sorted ascending), without a `getPools` network round trip. BHP256 hashing uses the optional `@provablehq/sdk` peer, loaded lazily on first call — read-only and wallet-backed paths never pull in the WASM SDK.
  - @provablehq/veil-core@0.4.1
