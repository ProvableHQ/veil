# @veil/bridge Design Spec

A bridge client for cross-chain swaps where Aleo is one side of the pair, sitting on top of `wallet-services-api`'s `/bridge/*` endpoints. Follows the same transport → client → actions shape as `@veil/core`.

## Goals

- Provide typed access to the WSA bridge endpoints (`getBridgeQuotes`, `createBridgeOrder`, `getBridgeOrder`, `getBridgeOrderAudit`).
- Encapsulate the common Aleo-source flow (quote → select → order → unshield → wait) as a single `swap` action that signs the Aleo deposit itself.
- Support inverse-direction flows (other chain → Aleo) via the primitive actions — the dapp signs the source-chain deposit, the package tracks the order.
- Expose every action as an MCP tool.
- Match `@veil/core`'s ergonomics: `createBridgeClient({ transport })`, actions bound onto the client.

## Non-Goals

- No ramp endpoints. Bridge swap only (api-flows §5). Ramps can ship later as `@veil/ramps`.
- No non-Aleo signing. The bridge package never imports `@solana/web3.js` or any other chain's SDK. Inverse-direction deposits are built and signed by the dapp.
- No source/destination pair where Aleo is on neither side. The WSA may support it; we don't.
- No bridge-provider routing logic. The WSA already fans out across providers.
- No wallet UI or modal.

## Direction Support

Aleo is always one side of the pair, in either direction. The package treats the two cases asymmetrically because only one side is something `@veil/bridge` can sign:

| Direction | How it works |
|---|---|
| **Aleo → other** (e.g., shielded ALEO → SOL) | `swap` end-to-end: gets quotes, creates order, builds + signs the `credits.aleo` `transfer_private_to_public` deposit via the passed-in `@veil/core` `WalletClient`, optionally polls. |
| **other → Aleo** (e.g., SOL → shielded ALEO) | Primitives only: dapp calls `getQuotes` + `createOrder`, builds + signs the source-chain deposit itself (with whatever SDK), then `waitForOrder`. Bridge package never signs. |

Aleo network is fixed to mainnet for v1. Destination chain for outbound swaps and source chain for inbound swaps are both parameterized.

## Package Layout

```
packages/bridge/
├── package.json                     # @veil/bridge, depends on @veil/core
├── src/
│   ├── clients/
│   │   ├── createBridgeClient.ts
│   │   └── decorators/bridge.ts
│   ├── transports/httpBridge.ts
│   ├── actions/
│   │   ├── getQuotes.ts
│   │   ├── createOrder.ts
│   │   ├── getOrder.ts
│   │   ├── getOrderAudit.ts
│   │   ├── waitForOrder.ts
│   │   └── swap.ts
│   ├── types/{bridge,envelope}.ts
│   ├── utils/unwrapEnvelope.ts
│   ├── errors/bridgeErrors.ts
│   ├── mcp/                         # MCP tool wrappers
│   └── agent/                       # agent JSON schemas
└── tests/
```

## Transport: `httpBridge`

Mirrors `packages/core/src/transports/http.ts` — a switch-based URL builder over `fetch`, returning JSON. Maps:

| Method | HTTP | Path |
|---|---|---|
| `getBridgeQuotes` | GET | `/bridge/quotes?…` |
| `createBridgeOrder` | POST | `/bridge/orders` (body `{quoteId}`, optional `x-timezone`) |
| `getBridgeOrder` | GET | `/bridge/orders/{id}` |
| `getBridgeOrderAudit` | GET | `/bridge/orders/{id}/audit` |

Routes are unversioned per api-flows. Transport returns raw response JSON (`{data, meta?}` envelope); actions unwrap via `unwrapEnvelope`.

## Client

```typescript
const bridge = createBridgeClient({
  transport: httpBridge('https://wallet-services.example/api'),
})
// → bridge.getQuotes, bridge.createOrder, bridge.getOrder,
//   bridge.getOrderAudit, bridge.waitForOrder, bridge.swap
```

`createBridgeClient` follows `createPublicClient`'s pattern: bare `createClient` + `extend(bridgeActions)`.

## Actions

Each action exports `Parameters` + `ReturnType` + function `(client, params) => Promise<Return>`. Decorator binds them onto the client.

### `getQuotes`
```typescript
type GetQuotesParameters = {
  fromChain: string; fromAsset: string
  toChain: string; toAsset: string
  amount: string                          // decimal string
  recipientAddress: string
}
type GetQuotesReturnType = {
  quotes: BridgeQuote[]
  meta: { count: number; quoteRequestId: string; warnings?: string[]; providerErrors?: ProviderError[] }
}
```
Returns `data` + `meta` — `meta.quoteRequestId` is the support handle.

### `createOrder`
```typescript
type CreateOrderParameters = { quoteId: string; timezone?: string }
type CreateOrderReturnType = BridgeOrderInstructions
// { orderId, depositAddress, depositAmount, depositChain, depositMemo?, instructions, expiration? }
```

### `getOrder`
```typescript
type GetOrderParameters = { id: string }
type GetOrderReturnType = BridgeOrderStatusDto
// { stage, currentStep, steps, finalStatus?, transactionHashes, timeline, … }
```

### `getOrderAudit`
```typescript
type GetOrderAuditParameters = { id: string }
type GetOrderAuditReturnType = BridgeOrderAuditDto
```

### `waitForOrder`
Polling convenience. Default ~3s initial interval with exponential backoff, default 30-minute ceiling.
```typescript
type WaitForOrderParameters = {
  id: string
  until?: BridgeOrderStage              // default 'COMPLETED'
  pollIntervalMs?: number               // default 3000, exponential backoff
  timeoutMs?: number                    // default 30 * 60_000
  onStage?: (status: BridgeOrderStatusDto) => void
}
type WaitForOrderReturnType = BridgeOrderStatusDto
```

### `swap` (Aleo-source encapsulated flow)
The headline agent action for outbound: quote → select → order → unshield to deposit address → optionally wait. Aleo source only — for inbound (other → Aleo) the dapp uses the primitives.

```typescript
type SwapParameters = {
  wallet: WalletClient                  // @veil/core, signs the Aleo deposit
  from: { asset: string; amount: string }
  to: { chain: string; asset: string; address: string }
  selectQuote?:
    | 'best'                            // best rate (default)
    | 'fastest'
    | ((quotes: BridgeQuote[]) => BridgeQuote | Promise<BridgeQuote>)
  poll?: boolean | BridgeOrderStage     // false → return after submit; true → 'COMPLETED'
  timezone?: string
  onStage?: (status: BridgeOrderStatusDto) => void
}
type SwapReturnType = {
  quoteRequestId: string
  orderId: string
  depositTxId: string                   // Aleo tx hash
  finalStatus?: BridgeOrderStatusDto
}
```

Implementation:
1. `getQuotes` derived from `from`/`to`.
2. `selectQuote` resolves to one `BridgeQuote`.
3. `createOrder({ quoteId })` → `BridgeOrderInstructions`.
4. Build + sign the deposit via the passed-in `WalletClient`: a `credits.aleo` `transfer_private_to_public` to `instructions.depositAddress` for `instructions.depositAmount`.
5. If `poll`, `waitForOrder` until terminal/specified stage.

## Envelope Handling

`unwrapEnvelope(response, { keepMeta?: boolean })` — helper used inside actions. Throws a typed error if `data` is absent. Keeps `meta` for `getQuotes`; strips it for the rest.

## Errors

`BridgeError` extends Veil's base error. Discriminated subclasses for: transport failure, envelope shape mismatch, terminal-stage failure (`FAILED`/`EXPIRED`/`REFUNDED`), timeout in `waitForOrder`.

## MCP Tools

One per action: `bridge_get_quotes`, `bridge_create_order`, `bridge_get_order`, `bridge_get_order_audit`, `bridge_wait_for_order`, `bridge_swap`. Schemas derived from the `Parameters` types. Lives under `src/mcp/`.

## Open Questions (deferred until v1)

- **Inbound swap convenience.** Once we have multiple non-Aleo source dapps, consider a `swapInto` that takes a chain-pluggable deposit signer interface — out of scope for v1.
- **Quote freshness.** Quotes expire. `swap` re-fetches if the chosen quote is past `expiresAt`? — defer.
- **Concurrent orders.** No explicit limit; if WSA enforces one, surface as a typed error.

## Reference Consumer

Used by `apps/pump-private-demo` to fund a fresh Solana key (`K_creator`) for an anonymous pump.fun launch. The dapp:

1. Does a `transfer_private` (Aleo → fresh intermediate address) via `@veil/core`.
2. Creates a wallet client for the intermediate, calls `bridge.swap({ wallet, to: { chain: 'solana', address: kCreator.pubkey }, … })`.
3. After `swap` resolves with `finalStatus.stage === 'COMPLETED'`, calls `pump-sdk.createAndBuyInstructions` signed by `kCreator`.

Fee-collection later uses the inbound direction: dapp gets quotes for SOL → ALEO, creates the order, signs the Solana deposit from `kCreator` itself (using `@solana/web3.js`), and calls `bridge.waitForOrder` to track completion. `@veil/bridge` is never asked to sign the Solana side.

`pump-private` stays a local, unpublished package inside the demo app — `@veil/bridge` is the only published surface this work adds.
