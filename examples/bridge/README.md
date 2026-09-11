# Bridge examples

These scripts demonstrate the current `@provablehq/aleo-bridge-sdk` lifecycle
against reviewed mainnet routes. Every script is read-only by default. It
prepares a structured route and obtains a live quote, but submits nothing until
its documented acknowledgement variable is set.

The examples cover:

| Script | Route | Protocol |
| --- | --- | --- |
| `eth-to-aleo.ts` | Ethereum ETH → Aleo ETH | Hyperlane |
| `wbtc-to-aleo.ts` | Ethereum WBTC → Aleo WBTC | Hyperlane |
| `eth-to-ethereum.ts` | Aleo ETH → Ethereum ETH | Hyperlane |
| `wbtc-to-ethereum.ts` | Aleo WBTC → Ethereum WBTC | Hyperlane |
| `sol-to-aleo.ts` | Solana SOL → Aleo SOL | Hyperlane |
| `sol-to-solana.ts` | Aleo SOL → Solana SOL | Hyperlane |
| `usdc-to-usdcx.ts` | Ethereum USDC → Aleo USDCx | Circle xReserve |
| `usdcx-to-usdc.ts` | Aleo USDCx → Ethereum USDC | Circle xReserve |

## Current lifecycle

Every implementation follows the same public API:

```ts
const plan = bridge.prepare({
  source: { chain: 'ethereum', asset: 'eth' },
  destination: { chain: 'aleo', asset: 'eth' },
  bridgeProtocol: 'hyperlane',
  amount: '0.001',
  sender,
  recipient,
})

const quote = await bridge.quote({ plan })
const execution = await bridge.execute({
  plan,
  onCheckpoint(checkpoint) {
    // Optional application-owned persistence boundary.
    saveCheckpoint(checkpoint)
  },
})

let progress = await bridge.wait({
  progress: { next: 'wait', plan, receipt: execution.receipt },
})

if (progress.next === 'resume') {
  const resumed = await bridge.resume({ progress, onCheckpoint: saveCheckpoint })
  progress = await bridge.wait({
    progress: { next: 'wait', plan, receipt: resumed.receipt },
  })
}
```

`wait()` verifies destination delivery. It does not submit another transaction.
For a private inbound xReserve transfer, `wait()` returns `next: 'complete'`
after Circle attests the deposit; `complete()` is the explicit authorization
for the Aleo private mint.

Checkpoints are plain JSON values, not storage. The SDK calls the supplied
closure, and the application chooses whether to save the value in a file,
database, browser storage, or nowhere. After a restart, pass the saved value to
`bridge.recover({ checkpoint })`. Recovery only reads state and never
resubmits funds.

## Accounts and RPC endpoints

The examples use the bridge package's account adapters directly:

```ts
const ethereum = createEvmClient({
  transport: evmHttp(process.env.ETHEREUM_RPC_URL!),
  account: evmPrivateKey(process.env.EVM_PRIVATE_KEY as `0x${string}`),
})

const solana = createSolanaClient({
  transport: solanaHttp(process.env.SOLANA_RPC_URL || DEFAULT_SOLANA_RPC_URL),
  account: solanaKeyPair(secretKeyBytes),
})

const aleo = createAleoClient({
  publicClient: nativeAleo.publicClient,
  account: nativeAleo.walletClient,
})
```

Local EVM and Solana keys sign locally. Aleo examples default to delegated
proving and accept the same `ALEO_RPC_URL`, `ALEO_PROVER_URL`,
`ALEO_CONSUMER_ID`, and `ALEO_DPS_API_KEY` overrides as
`@provablehq/veil-aleo-sdk`.

Never put private keys directly in shell history. Read them silently:

```sh
read -rs EVM_PRIVATE_KEY && export EVM_PRIVATE_KEY
read -rs SOLANA_PRIVATE_KEY && export SOLANA_PRIVATE_KEY
read -rs ALEO_PRIVATE_KEY && export ALEO_PRIVATE_KEY
```

## Ethereum → Aleo Hyperlane

Shared configuration:

```sh
export ETHEREUM_RPC_URL='https://ethereum-rpc.publicnode.com'
export ALEO_RECIPIENT='aleo1...'
```

Quote ETH:

```sh
export ETH_AMOUNT='0.001'
pnpm tsx examples/bridge/eth-to-aleo.ts
```

Submit ETH after reviewing the quote:

```sh
EXECUTE_HYPERLANE_ETH=I_UNDERSTAND_THIS_MOVES_REAL_FUNDS \
  pnpm tsx examples/bridge/eth-to-aleo.ts
```

For WBTC, set `WBTC_AMOUNT` and run `wbtc-to-aleo.ts`. Execution uses
`EXECUTE_HYPERLANE_WBTC=I_UNDERSTAND_THIS_MOVES_REAL_FUNDS`. The bridge action
checks allowance and submits an exact approval only when required.

## Aleo → Ethereum or Solana Hyperlane

These routes burn public ARC-20 balances on Aleo. Use `bridge.unshield()` first
when the asset is held privately.

```sh
export ALEO_PRIVATE_KEY='...'
export ETHEREUM_RPC_URL='https://ethereum-rpc.publicnode.com'
export ETHEREUM_RECIPIENT='0x...'
export ETH_AMOUNT='0.001'
pnpm tsx examples/bridge/eth-to-ethereum.ts
```

Execution acknowledgements are:

- `EXECUTE_HYPERLANE_ETH_RETURN=I_UNDERSTAND_THIS_MOVES_REAL_FUNDS`
- `EXECUTE_HYPERLANE_WBTC_RETURN=I_UNDERSTAND_THIS_MOVES_REAL_FUNDS`
- `EXECUTE_HYPERLANE_SOL_RETURN=I_UNDERSTAND_THIS_MOVES_REAL_FUNDS`

The action obtains a fresh Hyperlane gas quote before proving. The hook payment
comes from public Aleo credits and is separate from the Aleo execution fee.

## Solana → Aleo Hyperlane

The read-only path accepts `SOLANA_SENDER`; execution derives the sender from
`SOLANA_PRIVATE_KEY` and rejects a conflicting configured address.

```sh
export ALEO_RECIPIENT='aleo1...'
export SOLANA_SENDER='...'
export SOL_AMOUNT='0.01'
pnpm tsx examples/bridge/sol-to-aleo.ts
```

`SOLANA_RPC_URL` defaults to the exported `DEFAULT_SOLANA_RPC_URL`. Submit with:

```sh
EXECUTE_HYPERLANE_SOL=I_UNDERSTAND_THIS_MOVES_REAL_FUNDS \
  pnpm tsx examples/bridge/sol-to-aleo.ts
```

The quote includes transfer amount, network fee, interchain gas payment, and
rent. Execution signs with `solanaKeyPair()`, checkpoints the signature at the
broadcast boundary, and waits for canonical Aleo mailbox delivery.

The package also includes a durable operator-oriented version:

```sh
cd packages/bridge
pnpm solana-deposit
```

It stores the checkpoint in `scripts/.solana-deposit.state.json`. Set
`EXECUTE_SOLANA_DEPOSIT=I_UNDERSTAND_THIS_MOVES_REAL_FUNDS` to submit, or pass
`--reset` to deliberately discard the saved checkpoint.

## Ethereum USDC → Aleo USDCx

```sh
export ETHEREUM_RPC_URL='https://ethereum-rpc.publicnode.com'
export ALEO_RECIPIENT='aleo1...'
export USDC_AMOUNT='2'
export USDCX_MINT_MODE='public' # public, record, or private
pnpm tsx examples/bridge/usdc-to-usdcx.ts
```

Submit with
`EXECUTE_XRESERVE_DEPOSIT=I_UNDERSTAND_THIS_MOVES_REAL_FUNDS`. Public and record
mints are relayer-driven. Private mode requires the matching `ALEO_PRIVATE_KEY`
and optionally `USDCX_SECRET_NONCE`; after Circle attests, the script calls
`complete()` exactly once to submit the private mint.

The minimum inbound amount is 2 USDC. A custom private-mint nonce is never
included in a checkpoint and must be stored separately by the application.

## Aleo USDCx → Ethereum USDC

```sh
export USDCX_AMOUNT='2.000001'
export ETHEREUM_RECIPIENT='0x...'
export USDCX_BURN_MODE='private' # or public
pnpm tsx examples/bridge/usdcx-to-usdc.ts
```

Submit with `EXECUTE_XRESERVE_BURN=I_UNDERSTAND_THIS_BURNS_USDCX`. Private mode
uses the configured Aleo record scanner to select an unspent USDCx record and
derives the live freeze-list exclusion proof before executing. The burn amount
must exceed the deployed 2 USDCx withdrawal fee.
