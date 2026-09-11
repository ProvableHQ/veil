/**
 * Quotes or executes an Ethereum USDC to Aleo USDCx xReserve transfer.
 *
 * The EVM and Aleo private keys remain local. Omit the execution
 * acknowledgement to run the read-only quote path.
 */

import { formatUnits, type Hex } from 'viem'
import {
  createAleoClient,
  createBridgeClient,
  createEvmClient,
  evmHttp,
  evmPrivateKey,
  type AleoMintMode,
  type BridgeCheckpoint,
} from '@provablehq/aleo-bridge-sdk'

const EXECUTION_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_MOVES_REAL_FUNDS'
const EXECUTION_ENVIRONMENT_VARIABLE = 'EXECUTE_BRIDGE'
const AMOUNT = '2'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function evmPrivateKeyFromEnvironment(): Hex {
  const name = 'EVM_PRIVATE_KEY'
  const value = required(name).replace(/^0x/i, '')
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${name} must contain exactly 32 hexadecimal bytes`)
  return `0x${value}`
}

function mintMode(): AleoMintMode {
  const value = process.env.USDCX_MINT_MODE?.trim() || 'public'
  if (value !== 'public' && value !== 'record' && value !== 'private') {
    throw new Error('USDCX_MINT_MODE must be public, record, or private')
  }
  return value
}

function checkpoint(label: string, value: BridgeCheckpoint): void {
  // Durable storage is optional. Saving this compact value enables recovery
  // after a browser close or process restart without storing protocol payloads.
  console.log(`${label}:`, JSON.stringify(value))
}

async function main(): Promise<void> {
  const mode = mintMode()
  const privateMintSecretNonce = mode === 'private'
    ? `${process.env.USDCX_SECRET_NONCE?.replace(/scalar$/, '') || '0'}scalar`
    : undefined
  const recipient = required('ALEO_RECIPIENT')
  const evmAccount = evmPrivateKey(evmPrivateKeyFromEnvironment())
  if (evmAccount.type !== 'local') throw new Error('Expected a local EVM account')

  // ── The clients ─────────────────────────────────────────────────────
  // Ethereum is always the signing source. Aleo needs a wallet client only for
  // `private` mode because that mode stops after attestation and asks the caller
  // to submit `private_mint`. Public and record mints are relayer-driven, so
  // those modes do not expose a destination signing step.
  let aleoClient: ReturnType<typeof createAleoClient> | undefined
  if (mode === 'private') {
    const { loadNetwork } = await import('@provablehq/veil-aleo-sdk')
    const network = await loadNetwork('mainnet')
    const aleo = network.createAleoClient({
      privateKey: required('ALEO_PRIVATE_KEY'),
      networkUrl: process.env.ALEO_RPC_URL?.trim() || 'https://api.provable.com/v2',
      provingMode: 'delegated',
      confirmationTimeout: 5 * 60_000,
    })
    if (String(aleo.account.address) !== recipient) {
      throw new Error(`ALEO_PRIVATE_KEY resolves to ${aleo.account.address}, but ALEO_RECIPIENT is ${recipient}`)
    }
    aleoClient = createAleoClient({ publicClient: aleo.publicClient, account: aleo.walletClient })
  }

  const bridge = createBridgeClient({
    environment: 'mainnet',
    clients: {
      ethereum: createEvmClient({
        transport: evmHttp(required('ETHEREUM_RPC_URL')),
        account: evmAccount,
      }),
      ...(aleoClient ? { aleo: aleoClient } : {}),
    },
  })

  // ── The plan ────────────────────────────────────────────────────────
  // The caller selects assets and constrains the protocol to xReserve. The
  // registry resolves the xReserve contract, Circle and Aleo domains, remote
  // token identifier, minimum amount, and destination programs. The canonical
  // route id is an output on `plan.route.id`.
  const plan = bridge.prepare({
    source: { chain: 'ethereum', asset: 'usdc' },
    destination: { chain: 'aleo', asset: 'usdcx' },
    bridgeProtocol: 'xreserve',
    amount: AMOUNT,
    recipient,
    sender: evmAccount.account.address,
    mintMode: mode,
  })

  // ── The quote ───────────────────────────────────────────────────────
  // `quote` reads USDC balance, allowance, and the route's maximum protocol
  // fee. It never signs or submits. A private nonce influences the destination
  // commitment, so the same secret must be supplied again after recovery.
  const transferQuote = await bridge.quote({ plan, privateMintSecretNonce })
  if (transferQuote.kind !== 'evm-xreserve') throw new Error(`Unexpected quote kind: ${transferQuote.kind}`)
  console.table({
    route: plan.route.id,
    amount: `${formatUnits(transferQuote.amountAtomic, 6)} USDC`,
    balance: `${formatUnits(transferQuote.balanceAtomic, 6)} USDC`,
    allowance: `${formatUnits(transferQuote.allowanceAtomic, 6)} USDC`,
    approvalRequired: transferQuote.approvalRequired,
    mintMode: mode,
  })
  if (process.env[EXECUTION_ENVIRONMENT_VARIABLE] !== EXECUTION_ACKNOWLEDGEMENT) return

  // ── The execution ───────────────────────────────────────────────────
  // `execute` submits an approval when required, then deposits USDC into the
  // xReserve contract. `onCheckpoint` receives public intent and submitted
  // transaction ids at each crash boundary; storing them remains an application
  // decision.
  let source = await bridge.execute({
    plan,
    privateMintSecretNonce,
    onCheckpoint(value) { checkpoint('source checkpoint', value) },
  })
  if (source.kind !== 'evm-xreserve') throw new Error(`Unexpected execution kind: ${source.kind}`)

  // ── Settlement and recovery ─────────────────────────────────────────
  // Circle waits for source finality before issuing the deposit attestation.
  // `wait` polls that read-only service. It returns `resume` only when an
  // approval landed but the deposit still needs explicit authorization.
  let progress = await bridge.wait({
    progress: { next: 'wait', plan, receipt: source.receipt },
  })

  if (progress.next === 'resume') {
    source = await bridge.resume({
      progress,
      privateMintSecretNonce,
      onCheckpoint(value) { checkpoint('source checkpoint', value) },
    })
    progress = await bridge.wait({
      progress: { next: 'wait', plan, receipt: source.receipt },
    })
  }

  if (progress.next === 'failed') throw new Error(progress.error)
  if (mode !== 'private') {
    console.log(`Circle attested the deposit; the ${mode} Aleo mint is relayer-driven.`)
    return
  }
  if (progress.next !== 'complete') throw new Error(`Unexpected next operation: ${progress.next}`)

  // Private delivery has one more caller boundary. `complete` submits exactly
  // one Aleo private-mint transaction and checkpoints its id before confirmation
  // reads; public and record modes never enter this branch.
  const destination = await bridge.complete({
    progress,
    privateMintSecretNonce,
    privateFee: false,
    onCheckpoint(value) { checkpoint('destination checkpoint', value) },
  })
  progress = await bridge.wait({
    progress: { next: 'wait', plan, receipt: destination.receipt },
  })
  if (progress.next === 'failed') throw new Error(progress.error)
  if (progress.next !== 'done') throw new Error(`Unexpected next operation: ${progress.next}`)
  console.log('Private USDCx mint completed:', progress.receipt.destinationTxId)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
