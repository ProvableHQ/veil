---
"@provablehq/shield-swap-sdk": minor
"@provablehq/shield-swap-cli": patch
---

Remove `ApiClient` methods for DEX API routes the server retired: the invite-code
access routes (`getAccessStatus`, `redeemAccessCode`, `listAccessCodes`,
`generateAccessCodes`), swap history (`getSwaps`, `getSwap`), the position, token,
and tick-spacing detail routes (`getPosition`, `getToken`, `getTickSpacings`),
token registration (`registerToken`), and the trading schema routes
(`getTradingSchemas`, `getTradingSchema`).

Access now goes through the referral endpoints: `getReferralStatus()` reports the
gate and `redeemReferralCode()` unlocks it. The `shield_swap_get_access_status`
and `shield_swap_redeem_access_code` agent tools keep their names and are backed
by those methods. Read a position's live state with the chain-direct `getPosition`
action, resolve a token from `getTokens()`, take tick spacings from `getFeeTiers()`,
and recover a wallet-path swap's blinded address from `getSwapOutput().recipient`.

The `shield-swap setup` command redeems invite codes through the referral endpoint.
