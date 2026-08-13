# @provablehq/veil-aleo-bridges

A protocol-oriented bridge client for Aleo. USDCx transfers use Circle
xReserve. ETH, WBTC, SOL, ALEO, and USAD transfers use Hyperlane Warp Routes.

The package is in preview and is not published to npm. The current foundation
provides reviewed route discovery and non-fund-moving transfer plans. Protocol
execution is under development.

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
Aleo domain, and USDCx program identifiers. Hyperlane entries are marked
`metadata-required` until router, domain, ISM, token, and gas-payment metadata
are pinned from one reviewed Hyperlane Registry commit. They remain discoverable
so applications can distinguish known route support from execution readiness.

## Exports

- `createBridgeClient`
- `getAssets` and `getRoutes`
- `prepareTransfer`
- `DEFAULT_BRIDGE_REGISTRY` and `validateBridgeRegistry`
- Protocol-neutral asset, route, plan, fee, step, status, and receipt types
- `createBridgeAgentTools` from `/agent`
- `createBridgeMcpServer` from `/mcp`

The agent and MCP surfaces expose discovery and planning only. They cannot move
funds in the current phase.

## Next implementation phases

1. Pin complete Hyperlane deployment metadata.
2. Add Circle deposit-attestation and Aleo USDCx mint planning/execution.
3. Add Aleo USDCx burn and Circle withdrawal execution.
4. Add Hyperlane dispatch, interchain gas quoting, message tracking, and
   destination confirmation.
5. Add injected Aleo, EVM, and Solana executors and gated protocol testnets.
