# @provablehq/aleo-bridge-sdk

A preview client for reviewed Aleo bridge routes. USDCx uses Circle xReserve;
ETH, WBTC, USDT, SOL, ALEO, and USAD use Hyperlane Warp Routes.

## Create a client

Connections are keyed by the chain IDs in the registry. Discovery and transfer
planning do not need connections.

```ts
import { createBridgeClient } from '@provablehq/aleo-bridge-sdk'

const bridge = createBridgeClient({ environment: 'mainnet' })
const routes = bridge.getRoutes({ sourceChainId: 'ethereum', destinationChainId: 'aleo' })
const plan = bridge.prepareTransfer({
  routeId: routes[0]!.id,
  amount: '1',
  recipient: aleoAddress,
})
```

`prepareTransfer` is pure and local. It validates the reviewed route, amount,
recipient, required signers, and first irreversible step without reading a
network or prompting a wallet.

## Browser application

```ts
import {
  aleoConnection,
  createBridgeClient,
  evmConnection,
  evmHttp,
  evmProvider,
  solanaConnection,
  solanaHttp,
  solanaWallet,
} from '@provablehq/aleo-bridge-sdk'

const bridge = createBridgeClient({
  environment: 'mainnet',
  connections: {
    ethereum: evmConnection({
      transport: evmHttp(ethereumRpcUrl),
      account: evmProvider(window.ethereum),
    }),
    solana: solanaConnection({
      transport: solanaHttp(solanaRpcUrl),
      account: solanaWallet({
        wallet,
        account: wallet.accounts[0],
        chain: 'solana:mainnet',
      }),
    }),
    aleo: aleoConnection({
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
  aleoConnection,
  createBridgeClient,
  evmConnection,
  evmHttp,
  evmPrivateKey,
  solanaConnection,
  solanaHttp,
  solanaKeyPair,
} from '@provablehq/aleo-bridge-sdk'

const bridge = createBridgeClient({
  environment: 'mainnet',
  connections: {
    ethereum: evmConnection({
      transport: evmHttp(ethereumRpcUrl),
      account: evmPrivateKey(evmPrivateKey),
    }),
    solana: solanaConnection({
      transport: solanaHttp(solanaRpcUrl),
      account: solanaKeyPair(solanaSecretKeyBytes),
    }),
    aleo: aleoConnection({
      publicClient: aleoPublicClient,
      account: localAleoWalletClient,
    }),
  },
})
```

Local EVM accounts sign through viem and broadcast through the configured
public source. Local Solana accounts sign locally and broadcast through their
connection's public client; the account never receives a duplicate RPC URL.

## Existing viem clients

```ts
const bridge = createBridgeClient({
  connections: {
    ethereum: evmConnection({ walletClient }),
  },
})
```

An existing viem `walletClient` also supplies the connection's public RPC
access. Pass a separate `publicClient` when reads and receipt polling should use
a different transport. It may be paired with `evmProvider(window.ethereum)` or
`evmLocalAccount(privateKeyToAccount(key))`. A definition rejects duplicate
public sources (`transport` plus `publicClient`) and duplicate wallet sources
(`account` plus `walletClient`). A local account requires a public source.

## Executing routes

All actions resolve the exact source or destination connection implied by the
validated route. They do not fall back to another chain of the same family.

```ts
const plan = bridge.prepareTransfer({
  routeId: 'hyperlane:ethereum/wbtc->aleo/wbtc',
  amount: '0.001',
  recipient: aleoAddress,
  sender: ethereumAddress,
})

const quote = await bridge.quoteEvmHyperlaneTransfer({ plan, recipientBytes32 })
const execution = await bridge.executeEvmHyperlaneTransfer({ plan, recipientBytes32 })
```

EVM collateral routes approve only when needed. USDT resets a non-zero
allowance before setting the required value. Timeouts preserve transaction IDs
in resumable receipts.

Fund-moving actions accept `onSubmitted`, which runs immediately after the
wallet or local signer returns the source transaction ID and before confirmation
polling. Persist that receipt durably inside the hook. xReserve deposits also
accept the persisted receipt as `resume`; approval or deposit confirmation then
continues without repeating the submitted transaction:

```ts
const execution = await bridge.executeEvmXReserveTransfer({
  plan,
  ...(checkpoint ? { resume: checkpoint } : {}),
  onSubmitted: saveCheckpoint,
})
```

For Solana, the active inbound route is native SOL:

```ts
const plan = bridge.prepareTransfer({
  routeId: 'hyperlane:solana/sol->aleo/sol',
  amount: '0.01',
  recipient: aleoAddress,
  sender: solanaAddress,
})

const quote = await bridge.quoteSolanaHyperlaneTransfer({ plan })
const execution = await bridge.executeSolanaHyperlaneTransfer({
  plan,
  ...(checkpoint ? { resume: checkpoint } : {}),
  onSubmitted: saveCheckpoint,
})
```

The quote reads the deployed IGP, the live fee for the compiled message, and
the execution preflight reads current rent exemptions. Confirmation searches
transaction history and records blockhash expiry. Passing the checkpoint back as
`resume` confirms the existing signature without signing or resubmitting.

Current Solana token support is native SOL only. The connection API is ready
for future SPL-token routes, but it does not support Solana USDC today. SPL or
Token-2022 support requires reviewed route metadata, token-account handling,
instruction builders, and golden vectors.

Circle attestation requests use the client-level `fetch` override:

```ts
const bridge = createBridgeClient({ fetch: instrumentedFetch })
const attestation = await bridge.getXReserveAttestation({ routeId, messageHash })
```

## Breaking migration from earlier release candidates

This package is pre-release, so the obsolete fields have no runtime aliases.

| Removed API | Replacement |
| --- | --- |
| `executors.evm` | `connections[chainId]: evmConnection({ account, transport/publicClient })` |
| `executors.solana` | `connections[chainId]: solanaConnection({ account, transport })` |
| `executors.aleo` | `connections[chainId]: aleoConnection({ account, publicClient })` |
| `solanaRpc` | `solanaConnection({ transport: solanaHttp(url) })` |
| `aleoPublicClient` | `aleoConnection({ publicClient })` |
| `xReserveHttpTransport` | top-level `fetch` |
| `solanaExecutorFromKeyPair` | `solanaKeyPair(secretKeyBytes)` |
| `solanaExecutorFromWalletAccount` | `solanaWallet({ wallet, account, chain })` |

## Optional dependencies

Install `@solana/kit` for Solana routes and `@provablehq/sdk` for private
USDCx recipient commitments. React Native applications using Solana also need
an Ed25519 Web Crypto polyfill.

The default registry is a reviewed, versioned deployment snapshot. Routes stay
`metadata-required` until every protocol identifier required for execution has
been verified.

## Live local-account release gate

`pnpm --filter @provablehq/aleo-bridge-sdk test:live` contains deployed-bridge journeys for local EVM, Solana, and
Aleo accounts. They are skipped unless `BRIDGE_LIVE_FUNDS=1` and
`BRIDGE_LIVE_STATE_DIR` are set. Mainnet fund-moving cases additionally require
`BRIDGE_LIVE_MAINNET_ACK=I_ACKNOWLEDGE_BRIDGE_MAINNET_FUNDS`.

Each journey writes a mode-`0600` checkpoint immediately after receiving its
source transaction ID. A rerun with that checkpoint verifies the existing
transaction and never submits the source transfer again. Passing requires a
confirmed source transaction, a Circle message hash or Hyperlane message ID,
and a destination transaction. Use dedicated minimally funded accounts; the
tests never print private keys or signed transaction bytes.
