# @provablehq/veil-aleo-bridges

A protocol-oriented bridge client for Aleo. USDCx transfers use Circle
xReserve. ETH, WBTC, USDT, SOL, ALEO, and USAD transfers use Hyperlane Warp Routes.

The package is in preview and is not published to npm. It provides reviewed
route discovery, non-fund-moving transfer plans, and injected-wallet execution
for Ethereum-to-Aleo xReserve USDC deposits and Hyperlane routes carrying ETH,
WBTC, and USDT. Aleo-origin and Solana execution paths remain under development.

## Current API

```ts
import { createBridgeClient } from '@provablehq/veil-aleo-bridges'

const bridge = createBridgeClient({ environment: 'mainnet' })

const routes = bridge.getRoutes({
  protocol: 'xreserve',
  sourceChainId: 'ethereum',
  destinationChainId: 'aleo',
})

const plan = bridge.prepareTransfer({
  routeId: routes[0]!.id,
  amount: '25',
  recipient: aleoAddress,
})

plan.steps
// approve → deposit → wait-attestation → mint
```

`prepareTransfer` is pure and local. It validates the route, amount precision,
and recipient format, then identifies every execution step and the first
irreversible operation. It does not query live fees, sign, submit, or move
funds.

## Ethereum xReserve execution

The xReserve action derives the Aleo wire recipient and 65-byte hook from the
plan. Select `public`, `record`, or `private`; the deprecated
`privateRecipient: true` option remains an alias for `mintMode: 'private'`.

```ts
const bridge = createBridgeClient({
  environment: 'testnet',
  executors: { evm: injectedProvider },
  xReserveHttpTransport: (url, init) => fetch(url, init),
})

const plan = bridge.prepareTransfer({
  routeId: 'xreserve:sepolia/usdc->aleo-testnet/usdcx',
  amount: '25',
  recipient: aleoAddress,
  sender: connectedEthereumAccount,
  mintMode: 'record',
})

const quote = await bridge.quoteEvmXReserveTransfer({ plan })
const execution = await bridge.executeEvmXReserveTransfer({ plan })
const attestation = await bridge.getXReserveAttestation({
  routeId: plan.route.id,
  messageHash: execution.receipt.id as `0x${string}`,
})
```

Execution reads USDC balance and allowance, submits an exact-amount approval
when needed, waits for confirmation, and calls the nonpayable
`depositToRemote`. It then validates `DepositedToRemote`, derives Circle's
deposit nonce, builds the canonical 305-byte payload, and returns
`ATTESTATION_PENDING` with the message hash and resumable protocol state.

Private mode lazily loads the optional `@provablehq/sdk` peer dependency. It
commits the intended recipient with BHP256 and directs the xReserve deposit to
`shielded_usdcx_wrapper.aleo`. Public and record modes do not load Aleo WASM.
Circle attestation HTTP access is injected so browser, Node, and React Native
applications can supply their own fetch-compatible transport.

## Ethereum Hyperlane execution

Pass an EIP-1193-compatible provider from MetaMask, Phantom, or another injected
wallet. The bridge never receives the wallet's private key.

```ts
import { createBridgeClient, type EvmBridgeExecutor } from '@provablehq/veil-aleo-bridges'

const bridge = createBridgeClient({
  environment: 'mainnet',
  executors: {
    evm: injectedProvider as EvmBridgeExecutor,
  },
})

const plan = bridge.prepareTransfer({
  routeId: 'hyperlane:ethereum/wbtc->aleo/wbtc',
  amount: '0.001',
  recipient: aleoAddress,
  sender: connectedEthereumAccount,
})

const quote = await bridge.quoteEvmHyperlaneTransfer({
  plan,
  recipientBytes32: encodedAleoRecipient,
})

const execution = await bridge.executeEvmHyperlaneTransfer({
  plan,
  recipientBytes32: encodedAleoRecipient,
})
```

`quoteEvmHyperlaneTransfer` calls the route's `quoteTransferRemote` function and
returns atomic native payment and token-allowance requirements. It does not sign
or submit a transaction.

`executeEvmHyperlaneTransfer` requotes immediately before submission. For WBTC
and USDT it reads the current ERC-20 allowance, submits `approve` only when the
allowance is insufficient, waits for confirmation, and then submits
`transferRemote`. USDT's non-zero allowance is reset to zero before setting a
new value. Native ETH routes skip approval and send the quoted total as
`msg.value`.

The wire recipient is currently explicit. `recipientBytes32` MUST be the exact
32-byte Aleo recipient encoding accepted by the enrolled Hyperlane router; it is
validated for width but is not derived from `plan.recipient` yet.

Receipt timeouts return `SOURCE_APPROVAL_PENDING` or `SOURCE_CONFIRMING` with the
submitted transaction identifiers. A timeout does not report the transaction as
failed. A confirmed dispatch returns `DELIVERY_PENDING` and includes the
Hyperlane message id when the Mailbox `DispatchId` event is present.

## Registry

`DEFAULT_BRIDGE_REGISTRY` is a versioned snapshot of chains, chain-specific
assets, and directional routes. Applications can pass a reviewed replacement:

```ts
const bridge = createBridgeClient({
  environment: 'testnet',
  registry: companyReviewedRegistry,
})
```

xReserve entries include Circle's published Ethereum/Sepolia USDC contracts,
Aleo domain, and USDCx program identifiers. Ethereum-to-Aleo ETH, WBTC, and USDT
routes pin router, domain, ISM, token, Mailbox, and gas-payment metadata to
Hyperlane Registry commit `2621c16f2db1ccb46643265c110dac5ca2c7c51a` and are
active. Reverse and other Hyperlane routes remain `metadata-required` until
their execution paths are implemented.

## Exports

- `createBridgeClient`
- `getAssets` and `getRoutes`
- `prepareTransfer`
- `quoteEvmHyperlaneTransfer` and `executeEvmHyperlaneTransfer`
- `quoteEvmXReserveTransfer`, `executeEvmXReserveTransfer`, and `getXReserveAttestation`
- Aleo address, xReserve hook, nonce, payload, and message-hash utilities
- `DEFAULT_BRIDGE_REGISTRY` and `validateBridgeRegistry`
- Protocol-neutral asset, route, plan, fee, step, status, and receipt types
- `createBridgeAgentTools` from `/agent`
- `createBridgeMcpServer` from `/mcp`

The agent and MCP surfaces expose discovery and planning only. They do not expose
the fund-moving EVM actions.

## Next implementation phases

1. Add Aleo wallet execution for the attested public, record, and wrapper-private mints.
2. Add Aleo USDCx burn and Circle withdrawal execution.
3. Add Aleo-origin Hyperlane dispatch and destination confirmation.
4. Add injected Solana execution and gated protocol testnets.
