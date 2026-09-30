# Bridge tutorial

The bridge client moves assets across reviewed Hyperlane and Circle xReserve
routes. Every transfer follows the same lifecycle:

1. Create chain clients.
2. Quote the transfer and retain its plan.
3. Execute the source transaction.
4. Wait for destination delivery.
5. Resume or complete a transfer only when the returned progress requests it.

The scripts in this directory run against mainnet. They use minimum transfer
amounts and remain read-only unless `EXECUTE_BRIDGE` contains the exact
acknowledgement shown below.

## Routes covered by the examples

| Script | Route | Protocol | Default amount |
| --- | --- | --- | ---: |
| [`eth-to-aleo.ts`](./eth-to-aleo.ts) | Ethereum ETH → Aleo ETH | Hyperlane | 1 wei |
| [`wbtc-to-aleo.ts`](./wbtc-to-aleo.ts) | Ethereum WBTC → Aleo WBTC | Hyperlane | 1 satoshi |
| [`eth-to-ethereum.ts`](./eth-to-ethereum.ts) | Aleo ETH → Ethereum ETH | Hyperlane | 1 atomic unit |
| [`wbtc-to-ethereum.ts`](./wbtc-to-ethereum.ts) | Aleo WBTC → Ethereum WBTC | Hyperlane | 1 satoshi |
| [`usdt-to-ethereum.ts`](./usdt-to-ethereum.ts) | Aleo USDT → Ethereum USDT | Hyperlane | 3 USDT |
| [`sol-to-aleo.ts`](./sol-to-aleo.ts) | Solana SOL → Aleo SOL | Hyperlane | 1 lamport |
| [`sol-to-solana.ts`](./sol-to-solana.ts) | Aleo SOL → Solana SOL | Hyperlane | 1 lamport |
| [`usdc-to-usdcx.ts`](./usdc-to-usdcx.ts) | Ethereum USDC → Aleo USDCx | Circle xReserve | 2 USDC |
| [`usdcx-to-usdc.ts`](./usdcx-to-usdc.ts) | Aleo USDCx → Ethereum USDC | Circle xReserve | 2.000001 USDCx |

Network fees and Hyperlane hook payments are separate from the transferred
amount. The xReserve withdrawal sends 2 USDC to Ethereum because the deployed
route retains its 2 USDCx withdrawal fee.

## Install and configure

The examples ship with `@provablehq/aleo-bridge-sdk`. In a new directory using
Node.js 22 or newer, install the example dependencies and copy the complete
example directory so sibling helper imports remain available:

```sh
npm init -y
npm pkg set type=module
npm install @provablehq/aleo-bridge-sdk @provablehq/veil-core @provablehq/veil-aleo-sdk @provablehq/sdk @solana/kit viem
npm install --save-dev tsx typescript @types/node
node -e "const fs = require('node:fs'); const path = require('node:path'); fs.cpSync(path.dirname(require.resolve('@provablehq/aleo-bridge-sdk/examples/README.md')), 'bridge-examples', { recursive: true, errorOnExist: true, force: false })"
cd bridge-examples
npx tsc --noEmit
```

In this repository, use `cd packages/bridge/examples` instead. Run the commands
below from the example directory. Private keys stay in the local process and
are passed through the bridge package's account adapters.

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

Delegated proving and record scanning run on the Provable gateway, which needs
no credentials.

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

Read-only applications may omit accounts. Registry discovery and most status
reads do not need a wallet client. `quote` needs the source public client when
the protocol reads balances, allowances, or fees.

## 2. Quote a route

`quote` validates a transfer against the reviewed route catalog and reads
current provider or network costs where the route exposes them. The caller
names the source asset, destination asset, amount, sender, recipient, and
optional provider. The returned `plan` records the exact transfer that later
actions must use.

```ts
const sender = await ethereum.walletClient!.getAddress()

const quote = await bridge.quote({
  source: { chain: 'ethereum', asset: 'eth' },
  destination: { chain: 'aleo', asset: 'eth' },
  bridgeProtocol: 'hyperlane',
  amount: '0.000000000000000001',
  sender,
  recipient: process.env.ALEO_RECIPIENT!,
})
const plan = quote.plan
console.log(plan.route.id)

if (quote.kind !== 'evm-hyperlane') {
  throw new Error(`Unexpected quote kind: ${quote.kind}`)
}

console.table({
  amountAtomic: quote.amountAtomic.toString(),
  hyperlaneFeeAtomic: quote.nativeFeeAtomic.toString(),
  transactionValueAtomic: quote.nativeValueAtomic.toString(),
})
```

The route id is an output. Applications do not need to construct strings such
as `hyperlane:ethereum/eth->aleo/eth`.

Protocol-specific quote fields remain available after narrowing `quote.kind`.
The top-level action selects the protocol implementation from the validated
route. It does not sign or submit a transaction.

## 3. Execute and wait

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

`wait` follows source confirmation, provider processing, and verifiable
destination delivery until the transfer finishes or needs another wallet
authorization. It does not sign and does not submit another transaction.

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

## 4. Persist checkpoints when recovery matters

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

Hyperlane handles ETH, WBTC, USDT, and SOL routes in these examples. The source
transaction dispatches a message, a relayer delivers it, and `wait` verifies
the destination chain rather than treating an explorer index as canonical.

Run an Ethereum-to-Aleo quote:

```sh
npx tsx eth-to-aleo.ts
```

Run an Aleo-to-Ethereum quote:

```sh
npx tsx eth-to-ethereum.ts
```

Run an Aleo-USDT-to-Ethereum quote:

```sh
npx tsx usdt-to-ethereum.ts
```

Run a Solana-to-Aleo quote:

```sh
export SOLANA_SENDER='...'
npx tsx sol-to-aleo.ts
```

The Solana read-only path accepts `SOLANA_SENDER`. Execution derives the sender
from `SOLANA_PRIVATE_KEY` and rejects a conflicting configured address.

Aleo-origin Hyperlane transfers spend public ARC-20 balances. If the amount is
held in a private record, call `bridge.unshield()` and wait for that Aleo
transaction to be accepted before running the outbound example. The xReserve
private withdrawal can spend a USDCx record directly and does not need this
conversion.

Hyperlane mints inbound Aleo assets into public balances. After delivery, call
`bridge.shield()` when the asset should be held or spent as a private record.
Shielding is a separate Aleo transaction and does not change the completed
cross-chain transfer.

## xReserve transfers

Circle xReserve bridges USDC on Ethereum and USDCx on Aleo. The inbound and
outbound routes have different destination behavior.

### Ethereum USDC to Aleo USDCx

The example defaults to a public mint:

```sh
npx tsx usdc-to-usdcx.ts
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
npx tsx usdcx-to-usdc.ts
```

Set `USDCX_BURN_MODE=public` to spend the public USDCx balance. Private mode
uses the configured record scanner to select the smallest unspent record that
covers the transfer and derives the current freeze-list exclusion proof.

Ethereum execution also requires `ETHEREUM_RPC_URL`. After Aleo acceptance,
the example polls Ethereum for up to 30 minutes, checks a successful receipt
with a matching xReserve withdrawal or Circle Gateway mint and canonical USDC
transfer, and checks the recipient's balance increase. It prints the Ethereum
transaction hash and net USDC received after two confirmations.

Use a dedicated recipient and **keep it idle during observation**. The provider
does not expose a destination hash tied to the Aleo burn; this is observed
delivery, not cryptographic burn-to-mint attribution. Other matching transfers
or balance activity cause ambiguity and require manual inspection.

The checkpoint, starting block, and balance are saved before submission under
`~/.local/state/veil/examples/usdcx-to-ethereum.json`. Set `WITHDRAWAL_STATE_FILE`
to choose another path. After a timeout or RPC failure, rerun the same command
with the same configuration and state file to follow the existing burn. **Do
not delete pending state or select a new file to retry a transfer.** A new file
starts a new withdrawal. If interrupted before a checkpoint is saved, the
example refuses to reburn until the submission outcome is investigated. A
crashed process may leave a `.lock` file; remove only that lock after confirming
that the original process has stopped. Arc destination mode retains its
provider-handoff behavior; the Arc journey examples verify delivery separately.

The wrapper requires a `[MerkleProof; 2]` non-inclusion witness for its
compliance list. The example fetches the live tree from
`usdcx_freezelist.aleo/compliance/freeze-list` and uses the Provable SDK's
`SealanceMerkleTree` to derive the witness for the Aleo signer immediately
before submission. The depth-15 tree is encoded as the wrapper contract's
required 16-field path because the SDK includes the selected leaf as the first
path element.

## Submit a reviewed example

Every script quotes first and exits without submitting by default. After
reviewing the route, amount, balances, and fees printed by the script, enable
the common execution acknowledgement for one command:

```sh
EXECUTE_BRIDGE=I_UNDERSTAND_THIS_MOVES_REAL_FUNDS \
  npx tsx eth-to-aleo.ts
```

The acknowledgement applies to all example routes. Keep it scoped to a single
command rather than exporting it into a persistent shell profile.

## Durable Solana operator script

Repository contributors can also use the
[Solana operator script](https://github.com/ProvableHQ/veil/blob/main/packages/bridge/scripts/solana-deposit.ts).
It persists checkpoints and recovers from them on the next run. This operator
script is separate from the packaged tutorials and retains its own execution
acknowledgement.

## Arc mainnet USDC to Aleo USDCx

`arc-to-aleo.ts` uses the current quote, execute, wait, resume, and complete
lifecycle. It supports public and private delivery. The default run quotes
2 USDC without submission; set `EXECUTE_BRIDGE=I_UNDERSTAND_THIS_MOVES_REAL_FUNDS`
to authorize execution. Recovery checkpoints are printed after submitted steps.

```sh
# Supply EVM_PRIVATE_KEY and ALEO_RECIPIENT through the environment.
pnpm tsx packages/bridge/examples/arc-to-aleo.ts
```

`ARC_RPC_URL` defaults to `https://rpc.mainnet.arc.io` (chain ID `5042`).
Testnet RPCs are rejected. Private delivery additionally requires
`USDCX_MINT_MODE=private` and the recipient's `ALEO_PRIVATE_KEY`.
Optional `USDCX_SECRET_NONCE` must be retained separately for recovery.

Aleo runners use credential-free delegated proving on the edge gateway by
default. `ALEO_PROVING_MODE=local` selects local proving; an optional provisioned
`EDGE_PROVABLE_API_KEY` authenticates with an API-key header. Legacy credentials
use `ALEO_CONSUMER_ID` / `ALEO_DPS_API_KEY` and explicit `ALEO_PROVER_URL` /
`ALEO_SCANNER_URL` gateway overrides.


## Base or Arbitrum → Arc → Aleo and back

`l2-arc-aleo-roundtrip.ts` runs four separately authorized mainnet legs using the
SDK. Set `START_CHAIN=base` or `START_CHAIN=arbitrum`; the fourth leg returns to
that same chain. Aleo receives **public USDCx**, then burns that public balance
on the return leg. This example does not demonstrate private record handling.

| LEG | Transfer | Protocol |
| --- | --- | --- |
| 1 | Base/Arbitrum → Arc | CCTP with forwarding |
| 2 | Arc → Aleo | xReserve public mint |
| 3 | Aleo → Arc | xReserve public burn |
| 4 | Arc → Base/Arbitrum | CCTP with forwarding |

Use dedicated, idle EVM and Aleo accounts throughout the journey. Fund the L2
account with native USDC and ETH for approval/burn gas, and the Aleo account
with public ALEO credits for proving/submission fees. The default starting
amount is 5 USDC (minimum 3); each later leg spends only the previous leg's
observed delivery. Leg 2 leaves 0.10 USDC on Arc for its source gas and the
final CCTP burn. That reserve is an example budget, not a gas-price guarantee.
Fees and reserved gas mean the returned amount is lower than the starting amount.

```sh
export START_CHAIN=base                 # or arbitrum
export EVM_ADDRESS=0x...                # same address on the L2 and Arc
export ALEO_RECIPIENT=aleo1...          # owns the public USDCx balance
export AMOUNT=5
export ROUNDTRIP_STATE_FILE="$HOME/.local/state/veil/examples/base-arc-aleo.json"

# Preview leg 1 with read-only clients; no signing keys are needed.
LEG=1 pnpm tsx packages/bridge/examples/l2-arc-aleo-roundtrip.ts
```

Supply `EVM_PRIVATE_KEY` and `ALEO_PRIVATE_KEY` securely through the environment.
The example checks that each signing key matches the configured address.
Run each command after the preceding leg reports destination receipt:

```sh
EXECUTE_BRIDGE=I_UNDERSTAND_THIS_MOVES_REAL_FUNDS LEG=1 pnpm tsx packages/bridge/examples/l2-arc-aleo-roundtrip.ts
EXECUTE_BRIDGE=I_UNDERSTAND_THIS_MOVES_REAL_FUNDS LEG=2 pnpm tsx packages/bridge/examples/l2-arc-aleo-roundtrip.ts
EXECUTE_BRIDGE=I_UNDERSTAND_THIS_MOVES_REAL_FUNDS LEG=3 pnpm tsx packages/bridge/examples/l2-arc-aleo-roundtrip.ts
EXECUTE_BRIDGE=I_UNDERSTAND_THIS_MOVES_REAL_FUNDS LEG=4 pnpm tsx packages/bridge/examples/l2-arc-aleo-roundtrip.ts
```

Omit `EXECUTE_BRIDGE` to preview a fresh leg or inspect a saved checkpoint.
RPC overrides are `BASE_RPC_URL`, `ARBITRUM_RPC_URL`, `ARC_RPC_URL`, and
`ALEO_RPC_URL`. Aleo proving uses the same optional gateway/proving settings as
the other examples. Published-package users can copy the shipped examples as
described above and replace the repository path with `bridge-examples/`.

Checkpoints are written atomically with owner-only permissions. After a timeout,
rerun the **same LEG, state file, addresses, and starting amount**. Recovery never
starts a new burn for a saved checkpoint. An attempted submission without a
checkpoint stops for manual chain inspection. Do not delete state to retry.
A process lock prevents concurrent writers; remove a stale `.lock` file only
after confirming that no process is still running. Keep the state file private:
prepared Aleo transaction bytes may be present, although signing keys are not.

CCTP completion verifies the destination mint through the SDK. Public xReserve
status stops at provider handoff; this example separately polls the public
USDCx or Arc USDC balance and records the received amount. **Balance observation
is not a cryptographic source-to-destination proof.** Unrelated activity can
invalidate it, so keep these accounts idle and inspect transaction history if
delivery is ambiguous. The withdrawal estimate is capped at 0.10 USDC before
submission, but the deployed Aleo burn has no on-chain fee cap. Unexpected fees
or partial delivery leave the leg pending rather than spending other balances.
