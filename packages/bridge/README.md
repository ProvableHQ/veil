# @provablehq/aleo-bridge-sdk

A preview client for reviewed Aleo bridge routes. USDCx uses Circle xReserve;
ETH, WBTC, USDT, SOL, ALEO, and USAD use Hyperlane Warp Routes.

## Create a client

Clients are keyed by the chain IDs in the registry. Discovery and transfer
planning do not need clients.

```ts
import { createBridgeClient } from '@provablehq/aleo-bridge-sdk'

const bridge = createBridgeClient({ environment: 'mainnet' })
const plan = bridge.prepare({
  source: { chain: 'ethereum', asset: 'usdc' },
  destination: { chain: 'aleo', asset: 'usdcx' },
  bridgeProtocol: 'xreserve',
  amount: '1',
  recipient: aleoAddress,
})
```

`prepare` is pure and local. It validates the reviewed route, amount,
recipient, required signers, and first irreversible step without reading a
network or prompting a wallet.

## Browser application

```ts
import {
  createAleoClient,
  createBridgeClient,
  createEvmClient,
  evmHttp,
  evmProvider,
  createSolanaClient,
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

The dedicated EVM transport performs reads and confirmation polling while the
EIP-1193 provider authorizes submissions. Omitting `transport` uses the
provider as the public fallback. Solana always requires a public transport;
Wallet Standard accounts retain their atomic `signAndSendTransaction` flow.

## Local-key bot

```ts
import {
  createAleoClient,
  createBridgeClient,
  createEvmClient,
  evmHttp,
  evmPrivateKey,
  createSolanaClient,
  solanaHttp,
  solanaKeyPair,
} from '@provablehq/aleo-bridge-sdk'

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
      account: localAleoWalletClient,
    }),
  },
})
```

Local EVM accounts sign through viem and broadcast through the configured
public source. Local Solana accounts sign locally and broadcast through their
client's public client; the account never receives a duplicate RPC URL.

## Existing viem clients

```ts
const bridge = createBridgeClient({
  clients: {
    ethereum: createEvmClient({ walletClient }),
  },
})
```

An existing viem `walletClient` also supplies the client's public RPC
access. Pass a separate `publicClient` when reads and receipt polling should use
a different transport. It may be paired with `evmProvider(window.ethereum)` or
`evmLocalAccount(privateKeyToAccount(key))`. A client rejects duplicate
public sources (`transport` plus `publicClient`) and duplicate wallet sources
(`account` plus `walletClient`). A local account requires a public source.

## Executing routes

All actions resolve the exact source or destination client implied by the
validated route. They do not fall back to another chain of the same family.

```ts
const plan = bridge.prepare({
  source: { chain: 'ethereum', asset: 'wbtc' },
  destination: { chain: 'aleo', asset: 'wbtc' },
  bridgeProtocol: 'hyperlane',
  amount: '0.001',
  recipient: aleoAddress,
  sender: ethereumAddress,
})

const quote = await bridge.quote({ plan })
const execution = await bridge.execute({ plan })
```

`quote` derives protocol wire values, including the Aleo recipient's
32-byte Hyperlane encoding, from the validated plan. Its `kind` field narrows
route-specific quote fields when an application needs them.

EVM collateral routes approve only when needed. USDT resets a non-zero
allowance before setting the required value. Timeouts preserve transaction IDs
in resumable receipts.

Fund-moving actions accept an optional `onCheckpoint` hook. EVM, Solana, and
injected-wallet clients call it as soon as submission returns an identifier.
A local Aleo client also calls it before broadcast with the fully proved,
serialized transaction, then again after submission. The pre-broadcast value
lets a restarted process submit the same transaction rather than prove or sign
a replacement. Checkpoints exclude private keys, records, proofs,
private-mint nonces, and Circle response bodies. A serialized Aleo transaction
is retained only because it becomes public when broadcast:

```ts
const execution = await bridge.execute({
  plan,
  onCheckpoint: saveCheckpoint,
})
```

Applications that remain alive can keep the returned receipt in memory and do
not need to store a checkpoint. After an interruption, `recover` reconstructs
the plan and receipt with read-only chain and protocol calls:

```ts
const progress = await bridge.recover({
  checkpoint: await loadCheckpoint(),
})

if (progress.next === 'resume') {
  await bridge.resume({ progress, onCheckpoint: saveCheckpoint })
}
```

`recover` never signs or submits. Its `next` field is `wait`, `resume`,
`complete`, `done`, or `failed`. An approval-only checkpoint may recover to
`resume`; that action authorizes only the remaining source deposit after the
confirmed allowance is re-read. Normal execution calls `execute` once.

A prepared Aleo source transaction recovers to `resume`, which broadcasts its
exact serialized transaction. A prepared private Aleo destination mint
recovers to `complete` with the same guarantee. Use `onProgress` for timing and
UI updates around Aleo proving:

```ts
await bridge.execute({
  plan,
  onProgress(event) {
    console.log(event.type)
  },
  onCheckpoint: saveCheckpoint,
})
```

For Solana, the active inbound route is native SOL:

```ts
const plan = bridge.prepare({
  source: { chain: 'solana', asset: 'sol' },
  destination: { chain: 'aleo', asset: 'sol' },
  bridgeProtocol: 'hyperlane',
  amount: '0.01',
  recipient: aleoAddress,
  sender: solanaAddress,
})

const quote = await bridge.quote({ plan })
const execution = await bridge.execute({
  plan,
  onCheckpoint: saveCheckpoint,
})
```

The quote reads the deployed IGP, the live fee for the compiled message, and
current rent exemptions. Its `totalLamports` is the executable balance
requirement: bridged amount, IGP payment, network fee, and required account
rent. Confirmation searches
transaction history and records blockhash expiry. `recover({ checkpoint })`
checks an existing signature without signing or resubmitting.

Current Solana token support is native SOL only. The client API is ready
for future SPL-token routes, but it does not support Solana USDC today. SPL or
Token-2022 support requires reviewed route metadata, token-account handling,
instruction builders, and golden vectors.

Circle attestation requests use the client-level `fetch` override. `wait`
polls through read-only states until the next caller boundary. A private
destination mint requires a separate explicit `complete` call:

```ts
const bridge = createBridgeClient({ fetch: instrumentedFetch })
let progress = await bridge.wait({
  progress: { next: 'wait', plan, receipt: sourceExecution.receipt },
})

if (progress.next === 'complete') {
  const destinationExecution = await bridge.complete({
    progress,
    privateMintSecretNonce: await secureStorage.get('private-mint-nonce'),
    onCheckpoint: saveCheckpoint,
  })

  progress = await bridge.wait({
    progress: { next: 'wait', plan, receipt: destinationExecution.receipt },
  })
}
```

`onCheckpoint` is optional. Persist its value before returning from the callback
when recovery across a page close or process restart is required. `recover`
reconstructs progress from the checkpoint alone. `wait` advances to the next
caller or relayer boundary. The lower-level `getStatus` and `waitForStatus`
actions remain available for exact lifecycle-state control. None of these read
actions submits a transaction.

## Direct protocol helpers

Protocol-specific helpers remain available as namespaced escape hatches without
being mixed into `BridgeClient`:

```ts
import { hyperlane, xreserve } from '@provablehq/aleo-bridge-sdk'

const hyperlaneQuote = await hyperlane.evm.quote(evmClient, {
  plan,
  recipientBytes32,
})
const xreserveQuote = await xreserve.evmToAleo.quote(evmClient, { plan })
```

The namespaces expose the same reviewed adapters used by the generic actions:
`hyperlane.{aleo,evm,solana}.{quote,execute}`,
`xreserve.evmToAleo.{quote,execute,getAttestation,complete}`, and
`xreserve.aleoToEvm.execute`. Pass `registry` inside the helper parameters only
when overriding the default registry. Pure call construction remains under the
standalone `build*` utilities.

An Aleo-origin xReserve quote subtracts the deployed 2 USDCx withdrawal fee
and rejects amounts that cannot leave a positive destination amount. An
Aleo-origin Hyperlane quote reports the exact public hook payment in
`paymentMicrocredits`; `executionFeeMicrocredits` and `totalMicrocredits` are
`null` because an execution fee is available only after account-authorized
transaction construction. When an Aleo-origin Hyperlane destination client is
configured, status polling verifies delivery from the destination balance
increase because the explorer does not currently index Aleo-origin messages.

## Breaking migration from earlier release candidates

This package is pre-release, so the obsolete fields have no runtime aliases.

| Removed API | Replacement |
| --- | --- |
| `executors.evm` | `clients[chainId]: createEvmClient({ account, transport/publicClient })` |
| `executors.solana` | `clients[chainId]: createSolanaClient({ account, transport })` |
| `executors.aleo` | `clients[chainId]: createAleoClient({ account, publicClient })` |
| `solanaRpc` | `createSolanaClient({ transport: solanaHttp(url) })` |
| `aleoPublicClient` | `createAleoClient({ publicClient })` |
| `xReserveHttpTransport` | top-level `fetch` |
| `solanaExecutorFromKeyPair` | `solanaKeyPair(secretKeyBytes)` |
| `solanaExecutorFromWalletAccount` | `solanaWallet({ wallet, account, chain })` |
| `prepareTransfer` | `prepare` |
| `quoteTransfer` | `quote` |
| `executeTransfer` | `execute` |
| chain-specific `quote*Transfer` methods | `quote({ plan })` |
| chain-specific source `execute*Transfer` methods | `execute({ plan })` |
| `executeXReserveBurn` | `execute({ plan, mode, userRecord, merkleProof })` |
| encoded `prepare({ routeId })` | `prepare({ source, destination, bridgeProtocol })` |
| `getXReserveAttestation` | `wait({ progress })` or `getStatus({ plan, receipt })` |
| `executeXReservePrivateMint` | `complete({ progress, privateMintSecretNonce })` |

## Optional dependencies

Install `@solana/kit` for Solana routes and `@provablehq/sdk` for private
USDCx recipient commitments. React Native applications using Solana also need
an Ed25519 Web Crypto polyfill.

The default registry is a reviewed, versioned deployment snapshot. Routes stay
`metadata-required` until every protocol identifier required for execution has
been verified.

## Integration and live bridge tests

`pnpm --filter @provablehq/aleo-bridge-sdk test:integration` runs deterministic
end-to-end lifecycle tests with controlled transports. These cover recovery,
waiting, private completion, rejection, and timeout behavior without spending
funds.

`pnpm --filter @provablehq/aleo-bridge-sdk test:live` contains deployed-bridge
journeys for local EVM, Solana, and Aleo accounts. Testnet and mainnet cases live
in separate directories under `test/integration/live`. They are skipped unless
`BRIDGE_LIVE_FUNDS=1` and `BRIDGE_LIVE_STATE_DIR` are set.

Mainnet cases are individually selected through a comma-separated allowlist:

```sh
export BRIDGE_LIVE_MAINNET_ACK=I_ACKNOWLEDGE_BRIDGE_MAINNET_FUNDS
export BRIDGE_LIVE_MAINNET_CASES=evm-xreserve
pnpm --filter @provablehq/aleo-bridge-sdk test:live:mainnet
```

Without the final execution acknowledgement, a newly selected case performs
only its live quote and prints the route, amount, source address, destination,
and protocol debit. After reviewing that output, submission additionally
requires:

```sh
export BRIDGE_LIVE_MAINNET_EXECUTE=I_ACKNOWLEDGE_THIS_SUBMITS_MAINNET_TRANSACTIONS
```

Available case names are `evm-xreserve`, `aleo-xreserve`, `evm-hyperlane`,
`solana-hyperlane`, and `aleo-hyperlane`. Aleo-source cases use
`BRIDGE_PRIVATE_KEY`, Ethereum-source cases use `BRIDGE_EVM_PRIVATE_KEY`, and
Solana-source cases use `BRIDGE_SOLANA_PRIVATE_KEY`. Each case also requires
only its relevant RPC and recipient variables.
The EVM xReserve case bridges exactly 2 USDC, the configured protocol minimum,
and also uses `BRIDGE_PRIVATE_KEY` to complete the private Aleo mint.
The Aleo xReserve case burns 2.000001 USDCx, one atomic unit above its
strict minimum. Hyperlane token amounts use one atomic source unit; required
network fees, rent, and interchain gas payments remain additional costs.

| Case | Additional configuration |
| --- | --- |
| `evm-xreserve` | `BRIDGE_PRIVATE_KEY`, `BRIDGE_LIVE_ETHEREUM_RPC_URL` |
| `aleo-xreserve` | `BRIDGE_LIVE_ETHEREUM_RPC_URL`, `BRIDGE_LIVE_ETHEREUM_RECIPIENT` |
| `evm-hyperlane` | `BRIDGE_LIVE_ETHEREUM_RPC_URL`, `BRIDGE_LIVE_ALEO_MAINNET_RECIPIENT`; optional `BRIDGE_LIVE_EVM_HYPERLANE_ROUTE_ID` |
| `solana-hyperlane` | `BRIDGE_LIVE_SOLANA_RPC_URL`, `BRIDGE_LIVE_ALEO_MAINNET_RECIPIENT` |
| `aleo-hyperlane` | `BRIDGE_LIVE_ALEO_HYPERLANE_ROUTE_ID`, `BRIDGE_LIVE_HYPERLANE_DESTINATION_RECIPIENT` |

Each journey writes a mode-`0600` checkpoint at every supported prepared and
submitted transaction boundary. Local Aleo transactions are durable before
broadcast; EVM, Solana, and injected-wallet APIs can checkpoint only after
their submission method returns. A rerun verifies the existing transaction or
broadcasts the exact prepared Aleo transaction. Passing requires a
confirmed source transaction plus route-appropriate destination evidence: an
accepted private mint, a Hyperlane destination transaction, or an observed EVM
balance increase. Use dedicated minimally funded accounts; the tests never
print private keys or signed transaction bytes. Mainnet checkpoints are
separated by case beneath `$BRIDGE_LIVE_STATE_DIR/mainnet`.
