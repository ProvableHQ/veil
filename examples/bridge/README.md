# Bridge tutorial

The bridge client moves assets across reviewed Hyperlane and Circle xReserve
routes. Every transfer follows the same lifecycle:

1. Create chain clients.
2. Prepare a route.
3. Quote the transfer.
4. Execute the source transaction.
5. Wait for destination delivery.
6. Resume or complete a transfer only when the returned progress requests it.

The scripts in this directory run against mainnet. They use minimum transfer
amounts and remain read-only unless `EXECUTE_BRIDGE` contains the exact
acknowledgement shown below.

## Routes covered by the examples

| Script | Route | Protocol | Default amount |
| --- | --- | --- | ---: |
| `eth-to-aleo.ts` | Ethereum ETH → Aleo ETH | Hyperlane | 1 wei |
| `wbtc-to-aleo.ts` | Ethereum WBTC → Aleo WBTC | Hyperlane | 1 satoshi |
| `eth-to-ethereum.ts` | Aleo ETH → Ethereum ETH | Hyperlane | 1 atomic unit |
| `wbtc-to-ethereum.ts` | Aleo WBTC → Ethereum WBTC | Hyperlane | 1 satoshi |
| `sol-to-aleo.ts` | Solana SOL → Aleo SOL | Hyperlane | 1 lamport |
| `sol-to-solana.ts` | Aleo SOL → Solana SOL | Hyperlane | 1 lamport |
| `usdc-to-usdcx.ts` | Ethereum USDC → Aleo USDCx | Circle xReserve | 2 USDC |
| `usdcx-to-usdc.ts` | Aleo USDCx → Ethereum USDC | Circle xReserve | 2.000001 USDCx |

Network fees and Hyperlane hook payments are separate from the transferred
amount. The xReserve withdrawal sends 2 USDC to Ethereum because the deployed
route retains its 2 USDCx withdrawal fee.

## Install and configure

Run the examples from the repository root. Private keys stay in the local
process and are passed through the bridge package's account adapters.

```sh
read -rs EVM_PRIVATE_KEY && export EVM_PRIVATE_KEY
read -rs SOLANA_PRIVATE_KEY && export SOLANA_PRIVATE_KEY
read -rs ALEO_PRIVATE_KEY && export ALEO_PRIVATE_KEY
```

Set only the recipients needed by a route:

```sh
export ALEO_RECIPIENT='aleo1...'
export ETHEREUM_RECIPIENT='0x...'
export SOLANA_RECIPIENT='...'
```

`ETHEREUM_RPC_URL` is required for Ethereum routes. `SOLANA_RPC_URL` defaults
to `DEFAULT_SOLANA_RPC_URL`, and `ALEO_RPC_URL` defaults to the Provable mainnet
API. Aleo transactions use delegated proving, public fee payment, a five-minute
confirmation timeout, and FeeMaster disabled.

Delegated proving accepts optional Provable API credentials:

```sh
export ALEO_CONSUMER_ID='...'
export ALEO_DPS_API_KEY='...'
```

## 1. Create chain clients

A chain client always exposes public reads. Supplying an account adds its
wallet client and enables actions that sign or submit transactions.

An EVM local key uses `evmPrivateKey`:

```ts
const ethereum = createEvmClient({
  transport: evmHttp(process.env.ETHEREUM_RPC_URL!),
  account: evmPrivateKey(process.env.EVM_PRIVATE_KEY as `0x${string}`),
})
```

A Solana local key uses `solanaKeyPair`:

```ts
const solana = createSolanaClient({
  transport: solanaHttp(process.env.SOLANA_RPC_URL || DEFAULT_SOLANA_RPC_URL),
  account: solanaKeyPair(secretKeyBytes),
})
```

An existing Veil Aleo client passes its native clients directly:

```ts
const nativeAleo = network.createAleoClient({
  privateKey: process.env.ALEO_PRIVATE_KEY!,
  provingMode: 'delegated',
  useFeeMaster: false,
})

const aleo = createAleoClient({
  publicClient: nativeAleo.publicClient,
  account: nativeAleo.walletClient,
})
```

Register clients by chain id:

```ts
const bridge = createBridgeClient({
  environment: 'mainnet',
  clients: { ethereum, aleo },
})
```

Read-only applications may omit accounts. `prepare`, registry discovery, and
most status reads do not need a wallet client. `quote` needs the source public
client when the protocol reads balances, allowances, or fees.

## 2. Prepare a route

`prepare` validates a structured transfer intent against the registry. The
caller names the source asset, destination asset, amount, sender, recipient,
and optional protocol constraint. The returned plan contains the canonical
route id and asset metadata used by later actions.

```ts
const sender = await ethereum.walletClient!.getAddress()

const plan = bridge.prepare({
  source: { chain: 'ethereum', asset: 'eth' },
  destination: { chain: 'aleo', asset: 'eth' },
  bridgeProtocol: 'hyperlane',
  amount: '0.000000000000000001',
  sender,
  recipient: process.env.ALEO_RECIPIENT!,
})

console.log(plan.route.id)
```

The route id is an output. Applications do not need to construct strings such
as `hyperlane:ethereum/eth->aleo/eth`.

## 3. Quote before signing

`quote` performs reads and does not sign or submit a transaction.

```ts
const quote = await bridge.quote({ plan })

if (quote.kind !== 'evm-hyperlane') {
  throw new Error(`Unexpected quote kind: ${quote.kind}`)
}

console.table({
  amountAtomic: quote.amountAtomic.toString(),
  hyperlaneFeeAtomic: quote.nativeFeeAtomic.toString(),
  transactionValueAtomic: quote.nativeValueAtomic.toString(),
})
```

Protocol-specific quote fields remain available after narrowing `quote.kind`.
The top-level action still selects the protocol implementation from
`plan.route`.

## 4. Execute and wait

`execute` authorizes the source-side operation. It may submit an ERC-20
approval before the bridge transaction when the allowance is insufficient.

```ts
const execution = await bridge.execute({
  plan,
  onCheckpoint(checkpoint) {
    console.log(JSON.stringify(checkpoint))
  },
})

let progress = await bridge.wait({
  progress: {
    next: 'wait',
    plan,
    receipt: execution.receipt,
  },
})
```

`wait` performs reads until the transfer reaches a caller boundary or a
terminal state. It does not sign and does not submit another transaction.

Handle every returned operation explicitly:

```ts
if (progress.next === 'resume') {
  const resumed = await bridge.resume({ progress })
  progress = await bridge.wait({
    progress: { next: 'wait', plan, receipt: resumed.receipt },
  })
}

if (progress.next === 'failed') {
  throw new Error(progress.error)
}

if (progress.next !== 'done') {
  throw new Error(`Unexpected next operation: ${progress.next}`)
}
```

`resume` is used when a confirmed approval exists but the irreversible source
transfer was not submitted. It submits only the remaining source operation.
Calling `execute` again would restart the broader source workflow and is not
the recovery path.

## 5. Persist checkpoints when recovery matters

A checkpoint contains the public transfer intent, registry version, and
transaction identifiers needed to reconstruct progress. It does not contain a
private key, Aleo record plaintext, or private-mint secret nonce.

The SDK does not manage storage. `onCheckpoint` is a callback supplied by the
application:

```ts
await bridge.execute({
  plan,
  onCheckpoint(checkpoint) {
    localStorage.setItem('bridge-checkpoint', JSON.stringify(checkpoint))
  },
})
```

After a restart, recover the plan and receipt from the saved checkpoint:

```ts
const checkpoint = JSON.parse(localStorage.getItem('bridge-checkpoint')!)
let progress = await bridge.recover({ checkpoint })

if (progress.next === 'wait') {
  progress = await bridge.wait({ progress })
}
```

`recover` performs reads only. It reports `wait`, `resume`, `complete`, `done`,
or `failed`; the application decides whether to authorize the requested next
operation. Checkpoint storage is optional when the process can remain alive
for the complete transfer.

## Hyperlane transfers

Hyperlane handles ETH, WBTC, and SOL routes in these examples. The source
transaction dispatches a message, a relayer delivers it, and `wait` verifies
the destination chain rather than treating an explorer index as canonical.

Run an Ethereum-to-Aleo quote:

```sh
pnpm tsx examples/bridge/eth-to-aleo.ts
```

Run an Aleo-to-Ethereum quote:

```sh
pnpm tsx examples/bridge/eth-to-ethereum.ts
```

Run a Solana-to-Aleo quote:

```sh
export SOLANA_SENDER='...'
pnpm tsx examples/bridge/sol-to-aleo.ts
```

The Solana read-only path accepts `SOLANA_SENDER`. Execution derives the sender
from `SOLANA_PRIVATE_KEY` and rejects a conflicting configured address.

Aleo-origin Hyperlane transfers burn public ARC-20 balances. Call
`bridge.unshield()` before preparing the transfer when an asset is held in a
private record.

## xReserve transfers

Circle xReserve bridges USDC on Ethereum and USDCx on Aleo. The inbound and
outbound routes have different destination behavior.

### Ethereum USDC to Aleo USDCx

The example defaults to a public mint:

```sh
pnpm tsx examples/bridge/usdc-to-usdcx.ts
```

Set `USDCX_MINT_MODE` to `record` or `private` to select a different Aleo
destination. Public and record mints are relayer-driven. A private mint stops
at `progress.next === 'complete'` after Circle produces an attestation.

`complete` is a separate authorization boundary because it submits the Aleo
private-mint transaction:

```ts
if (progress.next === 'complete') {
  const destination = await bridge.complete({
    progress,
    privateMintSecretNonce,
    privateFee: false,
  })

  progress = await bridge.wait({
    progress: { next: 'wait', plan, receipt: destination.receipt },
  })
}
```

A custom `USDCX_SECRET_NONCE` must be stored separately. Checkpoints exclude
that secret.

### Aleo USDCx to Ethereum USDC

The outbound example defaults to a private burn:

```sh
pnpm tsx examples/bridge/usdcx-to-usdc.ts
```

Set `USDCX_BURN_MODE=public` to spend the public USDCx balance. Private mode
uses the configured record scanner to select the smallest unspent record that
covers the transfer and derives the current freeze-list exclusion proof.

## Submit a reviewed example

Every script quotes first and exits without submitting by default. After
reviewing the route, amount, balances, and fees printed by the script, enable
the common execution acknowledgement for one command:

```sh
EXECUTE_BRIDGE=I_UNDERSTAND_THIS_MOVES_REAL_FUNDS \
  pnpm tsx examples/bridge/eth-to-aleo.ts
```

The acknowledgement applies to all example routes. Keep it scoped to a single
command rather than exporting it into a persistent shell profile.

## Durable Solana operator script

`packages/bridge/scripts/solana-deposit.ts` is an operator-oriented variant of
the Solana inbound example. It persists checkpoints atomically to
`packages/bridge/scripts/.solana-deposit.state.json` and recovers from that
file on the next run.

```sh
cd packages/bridge
pnpm solana-deposit
```

The operator script intentionally retains its separate
`EXECUTE_SOLANA_DEPOSIT` acknowledgement and `DEPOSIT_SOL` amount because it is
not a fixed tutorial transfer. Pass `--reset` only when the stored checkpoint
has been reviewed and is safe to discard.
