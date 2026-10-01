# Configure server wallets for bridge transfers

Privy and Dynamic helpers connect existing EVM and Solana server wallets to
`createBridgeClient`. A backend can authorize bridge transactions without a
browser session or exporting a wallet private key.

| Provider entry point | EVM helper | Solana helper |
| --- | --- | --- |
| `@provablehq/aleo-bridge-sdk/privy` | `createPrivyEvmClient` | `createPrivySolanaClient` |
| `@provablehq/aleo-bridge-sdk/dynamic` | `createDynamicEvmClient` | `createDynamicSolanaClient` |

Each helper accepts an authenticated provider client and a public RPC transport.
It returns the same `EvmClient` or `SolanaClient` used throughout the bridge SDK.
Construction does not sign, broadcast, create wallets, or persist credentials.
Provider authentication and wallet provisioning are explicit caller operations.

## Install and run the configuration examples

Use Node.js 22 or newer. Dynamic's SDK requires a standard Node runtime with
native-addon support. These server entry points belong in backend code.

Install the provider used by the application:

```sh
pnpm add @provablehq/aleo-bridge-sdk viem@^2.45.3 @solana/kit@^8
pnpm add @privy-io/node@0.35.0
# For Dynamic instead (or both providers):
pnpm add @dynamic-labs-wallet/node-evm@1.1.24 @dynamic-labs-wallet/node-svm@1.1.24
pnpm add -D tsx typescript @types/node
```

The tested versions are Privy `0.35.0`, Dynamic `1.1.24`, viem `2.54.6`, and Solana Kit `8.1.0`.
Privy declares an optional Kit `^5.1.0` peer, so pnpm reports a peer warning with
Kit 8. These helpers use Privy's wire-transaction API, not its Kit adapter;
the bridge decodes and validates transactions with its own Kit 8 dependency.

Copy this directory from the installed package, or use it directly from the
repository. Keep only the chosen provider's `.ts` example when installing one
provider; the local `tsconfig.json` checks every `.ts` file in this directory.

```sh
node -e "const fs = require('node:fs'); const path = require('node:path'); fs.cpSync(path.dirname(require.resolve('@provablehq/aleo-bridge-sdk/examples/remote-wallets/README.md')), 'remote-wallets', { recursive: true, errorOnExist: true, force: false })"
cd remote-wallets
pnpm exec tsx privy.ts
# Or:
pnpm exec tsx dynamic.ts
```

TypeScript projects using Dynamic 1.1.24 need `moduleResolution: "Bundler"`
with `module: "ESNext"` (as in this directory's config): Dynamic's published
declaration entry point uses an extensionless re-export that NodeNext does not
resolve. This setting affects type checking; the examples run under Node via tsx.

Both examples print public wallet addresses. They do not request signatures or
submit transactions. The Dynamic example authenticates the two provider clients.
Ethereum defaults to the public mainnet RPC at `https://ethereum-rpc.publicnode.com`.
Set `ETHEREUM_RPC_URL` to override it with another Ethereum mainnet endpoint;
unset, empty, or whitespace-only values use the default. Set `SOLANA_RPC_URL`
to the intended Solana mainnet endpoint.

## Privy

Create a Privy app and provision one Ethereum wallet and one Solana wallet using
[Privy's wallet creation API](https://docs.privy.io/wallets/wallets/create/create-a-wallet).
Retain each wallet's ID and address. The server must be authorized to sign for
those wallets; pass an authorization context when the wallet's ownership policy
requires it.

The [Privy example](./privy.ts) reads:

- `PRIVY_APP_ID` and `PRIVY_APP_SECRET` to construct the provider client.
- `PRIVY_EVM_WALLET_ID` and `PRIVY_EVM_ADDRESS` for the Ethereum signer.
- `PRIVY_SOLANA_WALLET_ID` and `PRIVY_SOLANA_ADDRESS` for the Solana signer.
- Optional `PRIVY_AUTHORIZATION_PRIVATE_KEY` for the wallet authorization context.

```ts
import { PrivyClient } from '@privy-io/node'
import { createPrivyEvmClient, createPrivySolanaClient } from '@provablehq/aleo-bridge-sdk/privy'
import { evmHttp, solanaHttp } from '@provablehq/aleo-bridge-sdk'

const privy = new PrivyClient({ appId, appSecret })
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
```

Both helpers accept `authorizationContext`, using Privy's native Node SDK type.
Wallet IDs and addresses MUST refer to the same wallet. Provider secrets and
wallet authorization keys remain in the caller's credential store.

## Dynamic

Follow [Dynamic's server-wallet setup](https://www.dynamic.xyz/docs/node/wallets/server-wallets/overview)
to enable server wallets, create an API token, and provision EVM and Solana wallets.
Create separate `DynamicEvmWalletClient` and `DynamicSvmWalletClient` instances
and authenticate each with `authenticateApiToken`.

Persist the **full `walletMetadata`** returned by `createWalletAccount` or
`importPrivateKey`, including its backup metadata. An address and wallet ID alone
are insufficient for restoring shares and signing. Wallet creation is a separate
operation and MUST NOT run automatically on each service restart.

The [Dynamic example](./dynamic.ts) reads:

- `DYNAMIC_ENVIRONMENT_ID` and `DYNAMIC_API_TOKEN` for provider authentication.
- `DYNAMIC_EVM_METADATA_FILE` and `DYNAMIC_SOLANA_METADATA_FILE`, paths to JSON
  containing the respective full `walletMetadata` objects.
- `DYNAMIC_EVM_WALLET_PASSWORD` and `DYNAMIC_SOLANA_WALLET_PASSWORD` for wallets
  created with encrypted shares backed up to Dynamic (`backUpToDynamic: true`).

For caller-managed shares, load `externalServerKeyShares` from a secrets store
and pass them with the full metadata. Passwords and key shares MUST NOT enter
bridge checkpoints or logs. Keep metadata current after password changes or
resharing, following [Dynamic's storage guidance](https://www.dynamic.xyz/docs/node/wallets/server-wallets/storage-best-practices).

```ts
const ethereum = await createDynamicEvmClient({
  client: dynamicEvm,
  walletMetadata: evmMetadata,
  password: evmPassword,
  transport: evmHttp(ethereumRpcUrl),
})
const solana = await createDynamicSolanaClient({
  client: dynamicSolana,
  walletMetadata: solanaMetadata,
  password: solanaPassword,
  chainId: '101',
  transport: solanaHttp(solanaRpcUrl),
})
```

`chainId` is Dynamic's policy network identifier (`'101'` for Solana mainnet),
not an EVM chain ID or Wallet Standard identifier. It MUST match the RPC network.
The adapter builds Dynamic's policy context from the exact transaction being
signed. Gas sponsorship is disabled because changing the fee payer would
invalidate the bridge's pre-existing Solana signatures.

## Use the configured clients

```ts
const bridge = createBridgeClient({
  environment: 'mainnet',
  clients: { ethereum, solana, aleo },
})
```

Configure `aleo` as described in the [bridge tutorial](../README.md). Use the
normal `quote` → `execute` → `wait` lifecycle, retaining checkpoints for recovery.
EVM execution validates the chain and sender, signs through the provider, and
broadcasts through the supplied RPC. Solana execution retains ephemeral bridge
signatures and verifies the remote fee-payer signature before broadcasting.

The adapters add no signing or broadcast retries. Provider SDKs can have their
own retry policies. After an uncertain submission, follow the tutorial's
recovery procedure instead of starting the same transfer again. Automated tests
exercise provider SDK code with local signing fixtures; they do not prove that
a production app's credentials, wallet policy, or balance permit a transfer.
