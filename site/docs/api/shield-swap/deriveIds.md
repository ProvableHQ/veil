---
sidebar_position: 15
---

# Deriving keys and ids locally

Every id `shield_swap_v3.aleo` computes by hashing a struct is computable
client-side, without the network. The helpers hash the exact preimage the
contract hashes (BHP256 over the struct literal), so a locally derived value
always matches the chain's. All of them load the optional `@provablehq/sdk`
peer on first use; they are otherwise pure — no network, no signing.

The actions already fill these ids into their returns wherever the preimage
is known — a local-signer swap or mint returns them from the transition
outputs, and wallet-path actions derive them best-effort when the peer is
installed. Reach for the helpers directly when reconstructing an id after
the fact, or when addressing state you have not touched yet.

## derivePoolKey

```ts
const poolKey = await derivePoolKey({ token0, token1, fee: 3000 })
```

`BHP256(PoolKey { token0, token1, fee })`, with the pair sorted ascending as
the contract does — order-independent in the token arguments. The key every
pool read and swap takes.

## deriveTickKey

```ts
const tickKey = await deriveTickKey({ pool: poolKey, tick: -600 })
```

`BHP256(TickKey { pool, tick })` — the `ticks` mapping key
[`getTick`](/api/shield-swap/getTick) reads.

## deriveSwapId

```ts
const swapId = await deriveSwapId({
  poolKey, zeroForOne, amountIn, sqrtPriceLimit, blindedAddress, nonce,
})
```

`BHP256(SwapKey)` exactly as the `swap` transition computes it, with the
blinded address occupying both the `recipient` and `caller` slots. The
`SwapHandle` carries every preimage field, so a wallet-path id is computable
from a persisted handle once the blinded address is known.

## derivePositionTokenId

```ts
const positionTokenId = await derivePositionTokenId({ request, recipient, nonce })
```

`BHP256(TokenIDPreimage { request, recipient, nonce })` exactly as `mint`
computes it. Every preimage field is client-known before submission —
including on the wallet path — so the id a mint will produce is computable
ahead of confirmation.

## deriveMultiHopSwapId

```ts
const swapId = await deriveMultiHopSwapId({
  tokenInId, tokenOutId, amountIn, amountOutMin,
  blindedAddress, hops, nonce, deadline,
})
```

`BHP256(SwapMultiHopRequest)` exactly as `swap_multi_hop` computes it —
unused hop slots zero-padded, and, unlike the single-hop preimage, the
deadline included.
