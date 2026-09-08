---
"@provablehq/shield-swap-sdk": minor
"@provablehq/shield-swap-cli": patch
---

Remove `ApiClient` methods for DEX API routes the server retired: the invite-code
access routes (`getAccessStatus`, `redeemAccessCode`, `listAccessCodes`,
`generateAccessCodes`), swap history (`getSwaps`, `getSwap`), the position, token,
and tick-spacing detail routes (`getPosition`, `getToken`, `getTickSpacings`),
token registration (`registerToken`), the trading schema routes
(`getTradingSchemas`, `getTradingSchema`), and public balances
(`getPublicBalances`, whose `/balances` route was removed earlier).

Public balances are now read from chain. The new `getPublicBalances` action (also
`client.getPublicBalances` and the `shield_swap_get_public_balances` agent tool,
which moves from the API tool set to the chain tool set) reads each AMM token
program's `balances` mapping for an address and returns raw base units keyed by
program. `getBalances` composes it with record-derived private balances and no
longer needs a DEX API credential — only the public token registry.

Access now goes through the referral endpoints: `getReferralStatus()` reports the
gate and `redeemReferralCode()` unlocks it. The `shield_swap_get_access_status`
and `shield_swap_redeem_access_code` agent tools keep their names and are backed
by those methods. Read a position's live state with the chain-direct `getPosition`
action, resolve a token from `getTokens()`, take tick spacings from `getFeeTiers()`,
and recover a wallet-path swap's blinded address from `getSwapOutput().recipient`.

The `shield-swap setup` command redeems invite codes through the referral endpoint.
