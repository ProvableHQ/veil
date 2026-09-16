# @provablehq/aleo-bridge-sdk

Moves assets between Aleo, Ethereum, and Solana through reviewed Hyperlane and
Circle xReserve deployments.

The package supports browser wallets and local keys. It does not choose a
wallet, store transfer progress, or submit a second transaction after an
interruption without caller authorization.

> This package is published as a preview. It is versioned separately from the
> `@provablehq/veil-*` packages, and its API is subject to breaking changes
> between minor releases.

## Supported transfers

| Source | Destination | Asset received | Provider |
| --- | --- | --- | --- |
| Ethereum ETH | Aleo | ETH | Hyperlane |
| Aleo ETH | Ethereum | ETH | Hyperlane |
| Ethereum WBTC | Aleo | WBTC | Hyperlane |
| Aleo WBTC | Ethereum | WBTC | Hyperlane |
| Ethereum USDT | Aleo | USDT | Hyperlane |
| Aleo USDT | Ethereum | USDT | Hyperlane |
| Solana SOL | Aleo | SOL | Hyperlane |
| Aleo SOL | Solana | SOL | Hyperlane |
| Ethereum USDC | Aleo | USDCx | Circle xReserve |
| Aleo USDCx | Ethereum | USDC | Circle xReserve |

The registry also contains incomplete ALEO and USAD Hyperlane entries for
deployment discovery. Those entries are marked `metadata-required` and cannot
be quoted or executed. Solana routes currently support native SOL, not USDC or
other SPL tokens.

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

The [bridge tutorial](../../examples/bridge/README.md) explains configuration,
safe read-only runs, mainnet authorization, checkpoints, and each provider's
observable completion boundary.

| Transfer | Example |
| --- | --- |
| Ethereum ETH → Aleo ETH | [`eth-to-aleo.ts`](../../examples/bridge/eth-to-aleo.ts) |
| Ethereum WBTC → Aleo WBTC | [`wbtc-to-aleo.ts`](../../examples/bridge/wbtc-to-aleo.ts) |
| Aleo ETH → Ethereum ETH | [`eth-to-ethereum.ts`](../../examples/bridge/eth-to-ethereum.ts) |
| Aleo WBTC → Ethereum WBTC | [`wbtc-to-ethereum.ts`](../../examples/bridge/wbtc-to-ethereum.ts) |
| Solana SOL → Aleo SOL | [`sol-to-aleo.ts`](../../examples/bridge/sol-to-aleo.ts) |
| Aleo SOL → Solana SOL | [`sol-to-solana.ts`](../../examples/bridge/sol-to-solana.ts) |
| Ethereum USDC → Aleo USDCx | [`usdc-to-usdcx.ts`](../../examples/bridge/usdc-to-usdcx.ts) |
| Aleo USDCx → Ethereum USDC | [`usdcx-to-usdc.ts`](../../examples/bridge/usdcx-to-usdc.ts) |

Each script quotes mainnet state and exits without submitting by default. The
script prints the exact acknowledgement required to authorize real funds.
