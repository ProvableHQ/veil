# @provablehq/veil-aleo-bridges

A protocol-oriented bridge client for Aleo. USDCx transfers use Circle
xReserve. ETH, WBTC, USDT, SOL, ALEO, and USAD transfers use Hyperlane Warp Routes.

The package is in preview and is not published to npm. It provides reviewed
route discovery, non-fund-moving transfer plans, and injected-wallet execution
for Ethereum-to-Aleo Hyperlane routes carrying ETH, WBTC, and USDT. Other
protocol execution paths remain under development.

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
- `DEFAULT_BRIDGE_REGISTRY` and `validateBridgeRegistry`
- Protocol-neutral asset, route, plan, fee, step, status, and receipt types
- `createBridgeAgentTools` from `/agent`
- `createBridgeMcpServer` from `/mcp`

The agent and MCP surfaces expose discovery and planning only. They do not expose
the fund-moving EVM actions.

## Next implementation phases

1. Add Aleo recipient-to-`bytes32` encoding and destination delivery tracking.
2. Add Circle deposit-attestation and Aleo USDCx mint planning/execution.
3. Add Aleo USDCx burn and Circle withdrawal execution.
4. Add Aleo-origin Hyperlane dispatch and destination confirmation.
5. Add injected Aleo and Solana executors and gated protocol testnets.
