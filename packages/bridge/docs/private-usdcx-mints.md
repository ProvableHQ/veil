# Private USDCx mints

A private xReserve deposit from an EVM chain mints a private USDCx record on
Aleo. The deposit commits to a secret nonce that only the recipient can open, so
the caller must choose where that nonce comes from before quoting. Every option
in this guide lives under the `circle` key of the bridge client config and of
`quote`, `execute`, `resume`, and `complete`.

| Nonce source | Who holds the secret | When to use it |
| --- | --- | --- |
| [Local Aleo account](#local-aleo-account) | The bridge client's identity store | Bots, servers, and scripts that hold an Aleo private key |
| [Connected wallet](#connected-wallet) | The user's wallet | Browser dApps where the wallet signs and proves |
| [Legacy secret nonce](#legacy-secret-nonce) | The application | Existing integrations that already manage a scalar; deprecated |

Pick exactly one. A private quote with no source is a compile error on a
client built without a store, and a `BridgeError` at runtime that names the
three options, because a deposit whose scalar is lost cannot be minted.
Combining two sources in a single call is also rejected.

```ts
// Compile error: Property 'circle' is missing ... required in type
// '{ circle: QuoteCircleOptions & PrivateMintNonceSource }'
await createBridgeClient({ clients }).quote({ ...intent, mintMode: 'private' })

// Either of these compiles.
await createBridgeClient({ clients, circle: { privateMintIdentities } }).quote({ ...intent, mintMode: 'private' })
await createBridgeClient({ clients }).quote({ ...intent, mintMode: 'private', circle: { privateMintSecretNonce } })
```

## Local Aleo account

The bridge client reserves a counter, derives the scalar and the public address
commitment, and stores them. Neither quoting nor completion contacts Shield or
a wallet.

### Configure the identity store

There is no default store. Configure one on the client, and make it durable
for any process that may restart between deposit and completion, because an
identity that is lost after its deposit cannot complete the mint. The
in-memory store exported as `memoryXReservePrivateMintIdentityStore` suits
tests and single-run scripts only.

```ts
import { createBridgeClient } from '@provablehq/aleo-bridge-sdk'
import { fileXReservePrivateMintIdentityStore } from '@provablehq/aleo-bridge-sdk/node'

const bridge = createBridgeClient({
  environment: 'mainnet',
  clients,
  circle: {
    privateMintIdentities: fileXReservePrivateMintIdentityStore('.veil/xreserve-private-mints.json'),
  },
})
```

Treat the store file like a view key: its scalars can link and authorize the
corresponding private mints. Use one store per signing account, network, and
wrapper deployment.

### Quote once per deposit

Quoting reserves an identity and returns its commitment on the plan. Every
quote consumes a counter, so quote once per intended deposit rather than on
every price refresh.

```ts
const quote = await bridge.quote({
  source: { chain: 'ethereum', asset: 'usdc' },
  destination: { chain: 'aleo', asset: 'usdcx' },
  amount: '10',
  sender: ethereumAddress,
  recipient: aleoAddress,
  mintMode: 'private',
})

quote.plan.circle?.privateMintAddressCommitment // reserved 32-byte commitment, lowercase hex
```

### Execute, wait, and complete

The plan carries the reserved commitment, so `execute` deposits against it
without reserving another. Completion looks the commitment up in the configured
store and supplies the scalar to `private_mint` itself.

```ts
const execution = await bridge.execute({ plan: quote.plan, onCheckpoint: saveCheckpoint })

let progress = await bridge.wait({
  progress: { next: 'wait', plan: quote.plan, receipt: execution.receipt },
})
if (progress.next === 'complete') {
  const destination = await bridge.complete({ progress, onCheckpoint: saveCheckpoint })
  progress = await bridge.wait({
    progress: { next: 'wait', plan: quote.plan, receipt: destination.receipt },
  })
}
```

`execute` rejects a plan that reserved an identity when the call also passes a
different `circle.privateMintAddressCommitment`, a `circle.walletPreparedDeposit`,
or a `circle.privateMintSecretNonce`. Quote again with the intended source.

### Recover after a restart

Checkpoints hold only the public commitment. Restore the same store, recover
the checkpoint, and continue with the same client.

```ts
const bridge = createBridgeClient({
  environment: 'mainnet',
  clients,
  circle: { privateMintIdentities: fileXReservePrivateMintIdentityStore('.veil/xreserve-private-mints.json') },
})

let progress = await bridge.recover({ checkpoint: loadCheckpoint() })
if (progress.next === 'resume') {
  const resumed = await bridge.resume({ progress, onCheckpoint: saveCheckpoint })
  progress = { next: 'wait', plan: progress.plan, receipt: resumed.receipt }
}
if (progress.next === 'wait') progress = await bridge.wait({ progress })
if (progress.next === 'complete') await bridge.complete({ progress, onCheckpoint: saveCheckpoint })
```

Completing against a store that never issued the commitment fails with
`Private mint identity is not present in the configured store`.

### Store guarantees

The file store writes a companion `.counter` file and a `.lock` directory next
to the identity file.

- A counter is consumed before derivation, so a failed derivation, failed save,
  cancelled transfer, or rejected transaction never recycles it.
- Each save replaces the file atomically with `0600` permissions.
- Reservations lock across store instances and Node processes that share the
  path. A regular file left at the lock path fails the reservation immediately.
- Back up and restore the identity file and its `.counter` together.

A custom store for a shared backend MUST implement the two optional methods:

```ts
import type { XReservePrivateMintIdentityStore } from '@provablehq/aleo-bridge-sdk'

const store: XReservePrivateMintIdentityStore = {
  load: async () => db.identities.all(),
  save: async (identities) => db.identities.replace(identities),
  // Consume a u32 at or above `minimum` durably, even if derivation later fails.
  allocateCounter: async (minimum) => db.counters.next('xreserve', minimum),
  // Hold a transaction or distributed lock around load, derivation, and save.
  runExclusive: async (action) => db.transaction(action),
}
```

A store without `allocateCounter` infers the next counter from saved identities
and cannot retain an allocation after a failed save.

### Derivation

The derivation matches Shield's network-specific algorithm at
[shield-core cc29a60](https://github.com/ProvableHQ/shield-core/blob/cc29a60dad12bbd31fea4552ba01f9606dc6f53f/src/domains/dapp/fulfillment/derivedInput/algorithms.ts).

- Nonce: `Poseidon8.hashToScalar([wrapper_address_field, network_domain, view_key_field, counter_field])`,
  where the domain is the little-endian ASCII field of `shielded_usdcx_mainnet`
  or `shielded_usdcx_testnet`.
- Hook data: selector `2`, the 32 little-endian bytes of the BHP256 address
  commitment, then 32 zero bytes.

Identities stored under an earlier derivation keep completing with their saved
scalar. The network-independent `shielded_usdcx` domain stays exported for
compatibility; new identities use the network-specific domains.

## Connected wallet

A wallet that supports the `shielded-usdcx-secret-nonce` derived input prepares
the public commitment and keeps the scalar. The SDK accepts the same
`walletPreparedDeposit` and `privateMintNonceInput` values used by the bridge
SDK patch in [AMM PR #920](https://github.com/ProvableHQ/amm-v3-monorepo/pull/920).
This path never reads or writes the identity store.

### Validate and save the preparation

The SDK sees only the public hook and the wrapper recipient. Before depositing,
the application MUST check the wallet's full preparation against the reviewed
route, amount, source account, recipient, and network, and MUST save it durably.
A failed save MUST stop execution.

```ts
import type { WalletPreparedXReserveDeposit } from '@provablehq/aleo-bridge-sdk'

// `preparation` is the wallet's response, already validated and saved.
const walletPreparedDeposit: WalletPreparedXReserveDeposit = {
  remoteRecipientBytes32: preparation.deposit.remoteRecipient,
  hookData: preparation.deposit.hookData,
}
```

### Quote and execute

```ts
const quote = await bridge.quote({
  source: { chain: 'ethereum', asset: 'usdc' },
  destination: { chain: 'aleo', asset: 'usdcx' },
  amount: '10',
  sender: ethereumAddress,
  recipient: aleoAddress,
  mintMode: 'private',
  circle: { walletPreparedDeposit },
})
const execution = await bridge.execute({
  plan: quote.plan,
  circle: { walletPreparedDeposit },
  onCheckpoint: saveCheckpoint,
})
```

The SDK validates the canonical private hook and the reviewed wrapper address,
then builds the EVM deposit from the plan and registry.

### Complete

Completion also needs the derived nonce request bound to the preparation. The
[wallet example](../examples/wallet-private-mint.ts) builds both options from
the saved preparation without contacting a network or wallet.

```ts
import { walletPrivateMintOptions } from './wallet-private-mint.js'

if (progress.next === 'complete') {
  await bridge.complete({ progress, ...walletPrivateMintOptions(quote.plan, walletPreparedDeposit) })
}
```

The helper expands to:

```ts
{
  circle: {
    walletPreparedDeposit,
    privateMintNonceInput: {
      type: 'derived',
      algorithm: 'shielded-usdcx-secret-nonce',
      args: {
        commitment: { type: 'string', value: walletPreparedDeposit.hookData.slice(4, 68) },
        recipient: { type: 'address', value: plan.recipient },
      },
    },
  },
}
```

The wallet must authorize that algorithm for input position 3 of the reviewed
wrapper's `private_mint` call. The SDK rejects a request with a different
algorithm, commitment, or recipient, and rejects local accounts on this path.

### Resume after a restart

Restore the saved preparation alongside the recovered checkpoint. The SDK checks
it against the checkpointed approval hook or the attested deposit hook before
asking the wallet to sign.

```ts
let progress = await bridge.recover({ checkpoint: loadCheckpoint() })
const options = walletPrivateMintOptions(progress.plan, loadPreparation())
if (progress.next === 'resume') {
  const resumed = await bridge.resume({ progress, ...options, onCheckpoint: saveCheckpoint })
  progress = { next: 'wait', plan: progress.plan, receipt: resumed.receipt }
}
if (progress.next === 'wait') progress = await bridge.wait({ progress })
if (progress.next === 'complete') await bridge.complete({ progress, ...options, onCheckpoint: saveCheckpoint })
```

## Legacy secret nonce

An application that manages its own scalar passes it on every call. It is
never written to a checkpoint, so the application MUST store it separately and
restore it before resuming or completing.

```ts
const privateMintSecretNonce = `${process.env.USDCX_SECRET_NONCE}scalar`

await bridge.quote({ ...intent, mintMode: 'private', circle: { privateMintSecretNonce } })
await bridge.execute({ plan, circle: { privateMintSecretNonce }, onCheckpoint: saveCheckpoint })
await bridge.resume({ progress, circle: { privateMintSecretNonce }, onCheckpoint: saveCheckpoint })
await bridge.complete({ progress, circle: { privateMintSecretNonce }, onCheckpoint: saveCheckpoint })
```

The flat `privateMintSecretNonce` field accepted by earlier releases still
works and is deprecated. Supplying both forms with different values throws
`circle.privateMintSecretNonce conflicts with the deprecated top-level option`.
