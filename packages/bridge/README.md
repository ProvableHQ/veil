# @provablehq/aleo-bridge-sdk

Moves assets through reviewed Hyperlane, Circle xReserve, and Circle CCTP deployments.
CCTP moves native USDC between Arc and Ethereum, Base, or Arbitrum; xReserve brings
Arc USDC to Aleo as USDCx and redeems Aleo USDCx back to Arc USDC.

The package supports browser wallets, local keys, and Privy or Dynamic server wallets. It does not choose a
wallet, store transfer progress, or submit a second transaction after an
interruption without caller authorization.

> This package is published as a preview. It versions in lockstep with the
> `@provablehq/veil-*` packages, but its API is subject to breaking changes
> between minor releases.

## Upgrading existing bridge integrations

Existing method signatures remain supported. Plans and checkpoints saved with
registry `2026-08-31.solana-deposits.1` work with this release when the route,
assets, and protocol-specific chain details match the reviewed previous
snapshot. Recovery validates that match before reading a network or signing.
It does not repeat a submitted source transaction. Unknown versions or changed
deployments still require an explicit migration; do not rewrite a checkpoint's
registry version to bypass validation.

**TypeScript consumers with exhaustive switches or complete lookup tables must
handle the new variants when upgrading this preview minor release:**

| Public type | Additional value |
| --- | --- |
| `BridgeProtocol` | `cctp` |
| `BridgeQuoteKind`, `BridgeQuote`, `BridgeExecutionKind`, `BridgeExecution` | `evm-cctp` discriminator |
| `BridgeNextAction.kind` | `cctp-mint` |
| `aleo-xreserve` quote `status` | `quoted` for routes with live fee estimates; fixed-fee routes retain `not-queried` |

For example, extend a protocol label map rather than casting away the new type:

```ts
import type { BridgeProtocol } from '@provablehq/aleo-bridge-sdk'

const protocolLabels = {
  xreserve: 'Circle xReserve',
  hyperlane: 'Hyperlane',
  cctp: 'Circle CCTP',
} satisfies Record<BridgeProtocol, string>
```

Add an `evm-cctp` case when branching on quotes or executions. Route discovery
now includes additional chains and routes; filter by protocol or endpoints if
an application only supports the existing integrations. Filtering limits
runtime discovery but does not narrow the exported TypeScript unions.

## Supported transfers

| Source | Destination | Asset received | Provider |
| --- | --- | --- | --- |
| Ethereum ETH | Aleo | ETH | Hyperlane |
| Aleo ETH | Ethereum | ETH | Hyperlane |
| Ethereum WBTC | Aleo | WBTC | Hyperlane |
| Aleo WBTC | Ethereum | WBTC | Hyperlane |
| Ethereum USDT | Aleo | USDT | Hyperlane |
| Aleo USDT | Ethereum | USDT | Hyperlane |
| Ethereum BAT | Aleo | BAT | Hyperlane |
| Aleo BAT | Ethereum | BAT | Hyperlane |
| Ethereum USDG | Aleo | USDG | Hyperlane |
| Aleo USDG | Ethereum | USDG | Hyperlane |
| Solana SOL | Aleo | SOL | Hyperlane |
| Aleo SOL | Solana | SOL | Hyperlane |
| Solana BAT, USDG, or ZEC | Aleo | BAT, USDG, or ZEC | Hyperlane |
| Aleo BAT, USDG, or ZEC | Solana | BAT, USDG, or ZEC | Hyperlane |
| Ethereum USDC | Aleo | USDCx | Circle xReserve |
| Arc USDC | Aleo | USDCx | Circle xReserve |
| Ethereum, Base, or Arbitrum USDC | Arc | USDC | Circle CCTP V2 |
| Arc USDC | Ethereum, Base, or Arbitrum | USDC | Circle CCTP V2 |
| Aleo USDCx | Ethereum or Arc | USDC | Circle xReserve |

The registry also contains incomplete ALEO and USAD Hyperlane entries for
deployment discovery. Those entries are marked `metadata-required` and cannot
be quoted or executed.

BAT, USDG, and ZEC use SPL-collateral warp routes on Solana. BAT and ZEC use
the classic SPL Token program; USDG uses Token-2022. The SDK can build and
submit both Solana-to-Aleo and Aleo-to-Solana transfers and tracks delivery by
the recipient's associated token account.

`SolanaHyperlaneRouteMetadata` retains its native SOL fields, including the
required `nativeCollateralPda`. SPL integrations use `SolanaHyperlaneSplRouteMetadata`;
code that accepts both kinds uses `SolanaHyperlaneTransferMetadata` and narrows
on `routerType === 'spl-collateral'`. `BuildTransferRemoteParameters` defaults to
native metadata; its optional type parameter accepts either new metadata type.
Existing native callers do not need a discriminator or other changes.

## Redeem Aleo USDCx on Arc

Use the existing private or public burn flow with `destination: { chain: 'arc',
asset: 'usdc' }`. The SDK targets xReserve domain `26` and enforces the deployed
2-USDCx minimum. Arc quotes read the live withdrawal-fee endpoint and execution
rechecks fee coverage before asking the Aleo wallet to prove and submit.
The burn transition has no on-chain fee cap; quoted delivery is an estimate.
The recipient receives USDC without signing or funding gas on Arc.

```ts
const quote = await bridge.quote({
  source: { chain: 'aleo', asset: 'usdcx' },
  destination: { chain: 'arc', asset: 'usdc' },
  amount: '2',
  recipient: arcAddress,
})
await bridge.execute({ plan: quote.plan, userRecord, merkleProof, onCheckpoint })
```

Persist checkpoints before submission and use `recover`/`resume` after an
interruption. Outbound xReserve status tracks source acceptance; destination
confirmation still requires an Arc receipt or balance check. Do not repeat a
burn because provider delivery is pending.

The opt-in `aleo-arc` mainnet test checks an accepted private burn, the Arc USDC
transfer event, and the recipient balance increase. One live run delivered
1.9836 USDC from a 2-USDCx burn in approximately 46 seconds including proving;
this measurement is not a delivery guarantee.

## Send Arc USDC to Ethereum, Base, or Arbitrum

Connect an Arc EVM wallet and a public client for the destination. Select
`ethereum` for Ethereum mainnet, `base`, or `arbitrum`:

```ts
const quote = await bridge.quote({
  source: { chain: 'arc', asset: 'usdc' },
  destination: { chain: 'base', asset: 'usdc' },
  amount: '5',
  sender: arcAddress,
  recipient: destinationAddress,
  cctp: { speed: 'standard', forwarding: true },
})
const execution = await bridge.execute({ plan: quote.plan, onCheckpoint })
const progress = await bridge.wait({
  progress: { next: 'wait', plan: quote.plan, receipt: execution.receipt },
})
```

The quote includes the current destination forwarding cost and carries an
approved fee ceiling into execution and checkpoint recovery. With forwarding,
the displayed receive amount deducts that full ceiling: excess forwarding gas
budget may be spent as a priority fee and is not promised as a refund. Forwarding pays
for destination submission; the recipient needs no destination gas or signature.
With `forwarding: false`, `complete` requires a destination wallet and its native
gas. Arc requires USDC for the burn plus source gas in either mode.
These routes transfer native USDC, including USDC received from an Aleo → Arc
withdrawal. ETH and bridged USDC variants such as USDC.e are not supported.

## Bring USDC to Arc

Configure EVM clients for the source chain and Arc, then use the same bridge
lifecycle as other routes:

```ts
const quote = await bridge.quote({
  source: { chain: 'ethereum', asset: 'usdc' }, // also 'base' or 'arbitrum'
  destination: { chain: 'arc', asset: 'usdc' },
  bridgeProtocol: 'cctp',
  amount: '5',
  sender: evmAddress,
  recipient: evmAddress,
  cctp: { speed: 'fast', forwarding: true, maxFee: '0.25' },
})
const execution = await bridge.execute({
  plan: quote.plan,
  onCheckpoint: saveCheckpoint,
})
const progress = await bridge.wait({
  progress: { next: 'wait', plan: quote.plan, receipt: execution.receipt },
})
```

`speed` defaults to `standard`. `forwarding` defaults to `true`: Circle submits
the destination mint and deducts its quoted fee, so the recipient need not
already hold Arc gas. With forwarding disabled, `complete` requires an Arc
signer with gas. `maxFee` is a decimal USDC ceiling; when omitted, the quote
pins the current fee. Execute the returned `quote.plan` to retain that ceiling.
A higher live fee requires a new quote. Source-chain gas is separate.

These routes accept native USDC only. They do not swap ETH or bridge arbitrary
ERC-20 tokens. After verified Arc delivery, a separate xReserve transfer can
move Arc USDC to Aleo USDCx. Persist each leg's checkpoint independently and
recover it before retrying; never repeat a submitted burn after a timeout.

If forwarding stalls after attestation, an application can call
`bridge.complete({ progress, cctp: { manualMint: true }, onCheckpoint })`
with a funded Arc signer. The SDK verifies the original burn and checks that
its nonce is unused; the original recipient and forwarding hook remain fixed.
This never repeats the source burn. Normal `wait` polling does not trigger
manual minting automatically.

Consumers with exhaustive switches MUST handle the new `cctp` protocol and
`evm-cctp` quote/execution variants.

## Create a browser client

A browser application supplies public network access and the wallet accounts
that may authorize transfers. Public clients read balances, fees, and
transaction status. Wallet clients request signatures only when a fund-moving
action runs.

```ts
import {
  createAleoClient,
  createBridgeClient,
  createEvmClient,
  createSolanaClient,
  evmHttp,
  evmProvider,
  solanaHttp,
  solanaWallet,
} from '@provablehq/aleo-bridge-sdk'

const bridge = createBridgeClient({
  environment: 'mainnet',
  clients: {
    ethereum: createEvmClient({
      transport: evmHttp(ethereumRpcUrl),
      account: evmProvider(window.ethereum),
    }),
    solana: createSolanaClient({
      transport: solanaHttp(solanaRpcUrl),
      account: solanaWallet({
        wallet,
        account: wallet.accounts[0],
        chain: 'solana:mainnet',
      }),
    }),
    aleo: createAleoClient({
      publicClient: aleoPublicClient,
      account: aleoWalletClient,
    }),
  },
})
```

An EIP-1193 provider, such as `window.ethereum`, can supply both EVM reads and
wallet requests when `transport` is omitted. A separate transport keeps public
reads independent from the wallet provider. Solana always requires a public
transport because Wallet Standard accounts authorize transactions but do not
provide general RPC access.

An existing viem wallet client can be passed as
`createEvmClient({ walletClient })`. Add `publicClient` when reads and receipt
polling should use a different viem client.

## Create a local-key client

A bot or server can use local EVM and Solana keys through the supplied account
adapters. An Aleo local account comes from `@provablehq/veil-aleo-sdk`, which
supports delegated or local proving.

```ts
import {
  createAleoClient,
  createBridgeClient,
  createEvmClient,
  createSolanaClient,
  evmHttp,
  evmPrivateKey,
  solanaHttp,
  solanaKeyPair,
} from '@provablehq/aleo-bridge-sdk'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleoNetwork = await loadNetwork('mainnet')
const {
  publicClient: aleoPublicClient,
  walletClient: aleoWalletClient,
} = aleoNetwork.createAleoClient({
    privateKey: aleoPrivateKey,
    provingMode: 'delegated',
  })

const bridge = createBridgeClient({
  environment: 'mainnet',
  clients: {
    ethereum: createEvmClient({
      transport: evmHttp(ethereumRpcUrl),
      account: evmPrivateKey(evmPrivateKey),
    }),
    solana: createSolanaClient({
      transport: solanaHttp(solanaRpcUrl),
      account: solanaKeyPair(solanaSecretKeyBytes),
    }),
    aleo: createAleoClient({
      publicClient: aleoPublicClient,
      account: aleoWalletClient,
    }),
  },
})
```

Local EVM and Solana accounts sign inside the caller's process and broadcast
through their configured transports. The bridge client never receives the raw
key after the account adapter is created.

## Create a server-wallet client

Bots and backend services can sign through Privy or Dynamic using optional
provider entry points. The helpers return the same chain clients used by the
bridge lifecycle, with public RPC access supplied independently.

| Import | Helpers |
| --- | --- |
| `@provablehq/aleo-bridge-sdk/privy` | `createPrivyEvmClient`, `createPrivySolanaClient` |
| `@provablehq/aleo-bridge-sdk/dynamic` | `createDynamicEvmClient`, `createDynamicSolanaClient` |

```ts
import { createPrivyEvmClient } from '@provablehq/aleo-bridge-sdk/privy'

const ethereum = await createPrivyEvmClient({
  client: privy,
  walletId: evmWallet.id,
  address: evmWallet.address,
  transport: evmHttp(ethereumRpcUrl),
})
```

The caller supplies an authenticated provider client and an existing wallet.
Construction does not sign or submit. EVM uses the provider's viem signer;
Solana retains the bridge's existing signatures and validates the remote
signature before broadcasting through the caller's RPC.

The [server-wallet guide](./examples/remote-wallets/README.md) covers provider
setup, optional dependencies and tested versions, wallet metadata, authorization,
and runnable configuration examples for both chains and providers.

## Find supported assets and routes

The registry is the reviewed catalog bundled with the package. Reading it does
not contact a network or request a wallet signature.

```ts
const assets = bridge.registry.getAssets({
  environment: bridge.environment,
  chainId: 'aleo',
})

const routes = bridge.registry.getRoutes({
  environment: bridge.environment,
  sourceChainId: 'ethereum',
  destinationChainId: 'aleo',
})
```

Applications select assets by chain and asset names. They do not construct
encoded route strings or copy contract addresses into transfer requests.
`getRoutes` can also return `metadata-required` entries; check `availability`
before presenting a route as executable.

## Move an asset across chains

Every transfer follows the same caller lifecycle:

1. `quote` checks that the requested transfer is supported and reports current
   costs that can be known before submission.
2. `execute` asks the source wallet to authorize the required source-chain
   transactions.
3. `wait` follows the submitted transfer until it finishes, fails, or requires
   another wallet authorization.
4. `resume` or `complete` runs only when `progress.next` requests that action.

### 1. Quote the transfer

The caller supplies the source asset, destination asset, amount, recipient, and
optional provider. The result reports route-specific fees, balance or approval
requirements where available, and the plan that must be passed to execution.
Quoting can read networks and providers, but it does not request a signature or
move funds.

```ts
const quote = await bridge.quote({
  source: { chain: 'ethereum', asset: 'wbtc' },
  destination: { chain: 'aleo', asset: 'wbtc' },
  bridgeProtocol: 'hyperlane',
  amount: '0.001',
  sender: ethereumAddress,
  recipient: aleoAddress,
})

if (quote.kind !== 'evm-hyperlane') {
  throw new Error(`Unexpected quote kind: ${quote.kind}`)
}

console.log(quote.amountAtomic)
console.log(quote.nativeFeeAtomic)
```

`quote.plan` identifies the exact route, amount, recipient, and reviewed
deployment that produced the quote. Keep this value unchanged for execution.

### 2. Authorize the source transfer

Execution may request more than one wallet transaction. An ERC-20 route can
require an approval before its bridge deposit. The result contains the latest
receipt and every transaction identifier already submitted.

```ts
const execution = await bridge.execute({
  plan: quote.plan,
  onCheckpoint(checkpoint) {
    saveCheckpoint(checkpoint)
  },
})
```

Once a source transaction has been submitted, do not call `execute` again for
the same transfer. Use the returned receipt while the application remains open,
or recover from the latest checkpoint after an interruption.

### 3. Follow the transfer

`wait` reads source confirmation, provider processing, and destination delivery
where the route exposes verifiable evidence. It does not request another
signature or submit a transaction.

```ts
let progress = await bridge.wait({
  progress: {
    next: 'wait',
    plan: quote.plan,
    receipt: execution.receipt,
  },
})
```

The `next` field is the only value an application needs to select the next
lifecycle action:

| `progress.next` | Caller action |
| --- | --- |
| `done` | Show completion. No further wallet action is required. |
| `failed` | Show the reported failure. Do not repeat a transaction that already succeeded. |
| `wait` | Call `wait` again when polling stopped at an application-selected status. |
| `resume` | Ask the source wallet to submit the remaining source operation. |
| `complete` | Ask the Aleo recipient to authorize a private USDCx mint. |

`resume` is used when work such as an ERC-20 approval succeeded but the source
deposit was not submitted. It does not repeat the confirmed approval.

```ts
if (progress.next === 'resume') {
  const resumed = await bridge.resume({ progress })
  progress = await bridge.wait({
    progress: {
      next: 'wait',
      plan: progress.plan,
      receipt: resumed.receipt,
    },
  })
}
```

`complete` applies only to an Ethereum USDC deposit that selected a private
USDCx mint. Circle first attests the deposit. The Aleo recipient then authorizes
one destination transaction that creates the private record.

```ts
if (progress.next === 'complete') {
  const destination = await bridge.complete({
    progress,
    privateMintSecretNonce,
  })
  progress = await bridge.wait({
    progress: {
      next: 'wait',
      plan: progress.plan,
      receipt: destination.receipt,
    },
  })
}
```

## Recover after an interruption

A checkpoint contains the public transfer intent and transaction identifiers
needed to find the transfer again. It excludes private keys, Aleo record
plaintext, proofs, and private-mint secret nonces.

The SDK calls `onCheckpoint` at supported submission boundaries. The callback
does not imply a storage system. A browser can use IndexedDB or local storage;
a server can use a database or file. Applications that stay open can keep the
receipt in memory and omit the callback.

```ts
await bridge.execute({
  plan: quote.plan,
  onCheckpoint(checkpoint) {
    localStorage.setItem('bridge-checkpoint', JSON.stringify(checkpoint))
  },
})
```

After a restart, `recover` reconstructs the plan and checks existing network or
provider state. It never signs, submits, or repeats a transaction.

Upgrade recovery services before deploying applications that write checkpoints
with a newer registry version. The current SDK accepts unchanged routes from
reviewed prior registry snapshots; older SDKs reject checkpoints written with the
new registry version. Keep saved checkpoints intact rather than rewriting their
version labels.

```ts
const checkpoint = JSON.parse(localStorage.getItem('bridge-checkpoint')!)
let progress = await bridge.recover({ checkpoint })

if (progress.next === 'wait') {
  progress = await bridge.wait({ progress })
}
```

The application then handles `progress.next` by the same table above. A private
mint nonce must be stored separately because it is intentionally absent from
the checkpoint.

For CCTP, an unavailable approval stays pending: an RPC returning `null` does
not prove that a transaction was dropped. After reconciling the original in the
wallet and confirming a replacement approval, explicitly select it:

```ts
const recovered = await bridge.recover({
  checkpoint,
  cctp: {
    approvalReplacement: {
      originalTransactionId: originalApprovalHash,
      replacementTransactionId: confirmedApprovalHash,
    },
  },
})
const updated = createBridgeCheckpoint(recovered.plan, recovered.receipt)
```

Persist `updated` before resuming. Recovery verifies the replacement's successful
receipt, signer, token, spender, and amount; it retains the original hash in
`source.replacedApprovalTransactionIds`. It does not submit another approval and
rejects replacement selection while the original transaction is visible or after
the burn was submitted.

If Circle omits the forwarding transaction hash for an already-minted CCTP
transfer, status checks search the newest 10,000 destination blocks in batches of
1,000 and verify the discovered receipt and USDC mint. Custom EVM clients need
`getBlockNumber` and must honor `getLogs` topics for this fallback. If the mint is
older or cannot be found, retain the checkpoint and supply its verified destination
transaction hash in `checkpoint.destination.transactionId` before recovering.
Terminal receipts return without provider polling.

## Use private assets on Aleo

Hyperlane routes mint wrapped assets into public Aleo balances and spend public
balances when bridging out of Aleo. Shielding and unshielding let the same asset
move between that public balance and a private Aleo record.

### Unshield before bridging out through Hyperlane

An outbound Hyperlane transfer cannot spend a private record directly. Convert
the amount into the account's public balance before quoting and executing the
bridge transfer.

```ts
const conversion = await bridge.unshield({
  asset: { chain: 'aleo', asset: 'sol' },
  amount: '0.01',
})

console.log(conversion.transactionId)
```

The Aleo wallet selects a sufficient record when it supports wallet-side record
requests. A local-key caller must supply the encoded record because a local
account cannot resolve a wallet-side record request. Wait for the Aleo
transaction to be accepted before spending the resulting public balance.

Private USDCx can be burned directly by the xReserve private withdrawal flow.
It does not need to be unshielded first.

### Shield an asset for private use on Aleo

After a Hyperlane transfer arrives, its Aleo balance is public. Convert any
amount that should be held or spent privately into a record owned by the Aleo
account.

```ts
const conversion = await bridge.shield({
  asset: { chain: 'aleo', asset: 'sol' },
  amount: '0.01',
})

console.log(conversion.transactionId)
```

Shielding and unshielding each submit an Aleo transaction and incur an Aleo
transaction fee. They are separate from bridge delivery. A failed privacy
conversion does not repeat or reverse the completed cross-chain transfer.

The default registry supports these conversions for wrapped ETH, WBTC, USDT,
and SOL through their ARC-20 programs, and for USDCx through its ARC-22
transfers. The current USDCx default uses the empty freeze-list proof. Supply a
current proof after the deployed freeze-list tree is populated.

## Complete examples

The packaged [agent guide](./skills/SKILL.md) explains how to discover and run
examples from an installed SDK. Resolve it with
`require.resolve('@provablehq/aleo-bridge-sdk/skills/SKILL.md')`.

The [bridge tutorial](./examples/README.md) explains configuration,
safe read-only runs, mainnet authorization, checkpoints, and each provider's
observable completion boundary.

| Transfer | Example |
| --- | --- |
| Ethereum ETH → Aleo ETH | [`eth-to-aleo.ts`](./examples/eth-to-aleo.ts) |
| Ethereum WBTC → Aleo WBTC | [`wbtc-to-aleo.ts`](./examples/wbtc-to-aleo.ts) |
| Aleo ETH → Ethereum ETH | [`eth-to-ethereum.ts`](./examples/eth-to-ethereum.ts) |
| Aleo WBTC → Ethereum WBTC | [`wbtc-to-ethereum.ts`](./examples/wbtc-to-ethereum.ts) |
| Aleo USDT → Ethereum USDT | [`usdt-to-ethereum.ts`](./examples/usdt-to-ethereum.ts) |
| Solana SOL → Aleo SOL | [`sol-to-aleo.ts`](./examples/sol-to-aleo.ts) |
| Aleo SOL → Solana SOL | [`sol-to-solana.ts`](./examples/sol-to-solana.ts) |
| Ethereum USDC → Aleo USDCx | [`usdc-to-usdcx.ts`](./examples/usdc-to-usdcx.ts) |
| Aleo USDCx → Ethereum or Arc USDC | [`usdcx-to-usdc.ts`](./examples/usdcx-to-usdc.ts) |

Each script quotes mainnet state and exits without submitting by default. The
script prints the exact acknowledgement required to authorize real funds.
