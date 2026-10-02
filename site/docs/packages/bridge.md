---
sidebar_position: 10
---

# @provablehq/aleo-bridge-sdk

:::caution Preview
The package is published to npm as a preview. It versions in lockstep with the `veil-*` packages, but its API is subject to breaking changes between minor releases. Execution is available for select routes through registry-keyed chain clients; other execution paths remain under development.
:::

The bridge client assigns each asset family to its canonical protocol:

- Circle xReserve moves USDC into and out of Aleo as USDCx.
- Hyperlane Warp Routes move ETH, WBTC, USDT, SOL, BAT, USDG, ZEC (Omnibridge), ALEO, and USAD.

The current API provides a versioned route registry, discovery, and transfer
quotes that return the validated execution plan:

```ts
import { createBridgeClient } from '@provablehq/aleo-bridge-sdk'

const bridge = createBridgeClient({ environment: 'mainnet' })
const quote = await bridge.quote({
  source: { chain: 'ethereum', asset: 'usdc' },
  destination: { chain: 'aleo', asset: 'usdcx' },
  bridgeProtocol: 'xreserve',
  amount: '25',
  recipient: aleoAddress,
})
const plan = quote.plan
```

`quote` validates the route, decimal precision, and recipient and returns the
ordered approval, protocol, attestation/delivery, and destination steps with
current costs where available. It does not sign or move funds.

Fund-moving actions accept an optional `onCheckpoint` hook. The compact value
contains its format version, public transfer intent, resolved route, and
transaction recovery data. Local Aleo clients emit a fully proved serialized
transaction before broadcast and a submitted identifier afterward. EVM,
Solana, and injected-wallet APIs checkpoint after their submission method
returns. Checkpoints exclude wallet secrets, private-mint nonces, records,
proofs, and Circle response bodies.

```ts
const execution = await bridge.execute({
  plan,
  onCheckpoint: saveCheckpoint,
})
```

After an interruption, `recover` reconstructs progress through read-only chain
and protocol requests. It never signs, proves, or submits a transaction.

```ts
const progress = await bridge.recover({
  checkpoint: await loadCheckpoint(),
})
```

`recover` rebuilds the runtime plan and returns `next: 'wait' | 'resume' |
'complete' | 'done' | 'failed'`. `wait({ progress })` polls to the next caller
boundary, `resume({ progress })` continues an approval-interrupted source flow
or broadcasts the exact checkpointed Aleo source transaction. A prepared Aleo
private mint recovers to `complete({ progress })`, which broadcasts that exact
destination transaction. The
lower-level `getStatus` remains available for one status read. Pass `until` to
`wait` to stop at an additional protocol state.

`onProgress` reports Aleo proving boundaries for UI and timing instrumentation.
Solana native-SOL quotes include the bridged amount, IGP payment, network fee,
and required rent in `totalLamports`. SPL-collateral quotes report the token
amount in `amountLamports` for backwards compatibility and exclude it from the
SOL-denominated `totalLamports`. Aleo xReserve withdrawals subtract the deployed 2
USDCx fee and require a positive net amount. Aleo Hyperlane quotes report the
public hook payment; their account-specific execution fee and total remain
`null` until transaction construction.

Hyperlane routes marked `metadata-required` are known route families whose
complete execution deployment has not been pinned yet. Applications MUST NOT
execute them until a reviewed registry marks them active.

BAT, USDG, and ZEC are active in both directions between Aleo and Solana. BAT
and ZEC use classic SPL Token accounts, while USDG uses Token-2022.
The SDK tracks Aleo-to-Solana delivery through the recipient's associated token account.

## Privy and Dynamic server wallets

A backend can authorize bridge transfers with existing Privy or Dynamic server
wallets. Import the helpers from the provider entry point:

| Provider | Import | Helpers |
| --- | --- | --- |
| Privy | `@provablehq/aleo-bridge-sdk/privy` | `createPrivyEvmClient`, `createPrivySolanaClient` |
| Dynamic | `@provablehq/aleo-bridge-sdk/dynamic` | `createDynamicEvmClient`, `createDynamicSolanaClient` |

Each helper takes an authenticated provider client, wallet identity, and public
RPC transport, returning the bridge's existing EVM or Solana client. Construction
does not sign or submit. Provider SDKs are optional peers and are not loaded by
the bridge's root entry point.

```ts
import { createBridgeClient, evmHttp, solanaHttp } from '@provablehq/aleo-bridge-sdk'
import { createPrivyEvmClient, createPrivySolanaClient } from '@provablehq/aleo-bridge-sdk/privy'

const ethereum = await createPrivyEvmClient({
  client: privy,
  walletId: evmWallet.id,
  address: evmWallet.address,
  transport: evmHttp(ethereumRpcUrl),
})
const solana = await createPrivySolanaClient({
  client: privy,
  walletId: solanaWallet.id,
  address: solanaWallet.address,
  transport: solanaHttp(solanaRpcUrl),
})
const bridge = createBridgeClient({
  environment: 'mainnet',
  clients: { ethereum, solana, aleo },
})
```

Privy helpers accept an optional `authorizationContext`. Dynamic helpers take the
full persisted `walletMetadata`, optional `password` and `externalServerKeyShares`,
and, for Solana, a required policy `chainId` such as `'101'` for mainnet. That
identifier MUST match the configured Solana RPC. Solana sponsorship is disabled
to preserve the bridge's existing signatures.

See the [server-wallet setup guide and runnable examples](https://github.com/ProvableHQ/veil/tree/main/packages/bridge/examples/remote-wallets)
for installation, tested dependency versions, provisioning, and credential
configuration. Use the regular quote, execute, wait, and recovery lifecycle after
creating the clients.
