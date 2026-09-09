/**
 * Moves USDC from Arc into USDCx on Aleo through Circle xReserve.
 *
 * The default run reads route constraints, balance, and allowance without
 * requesting a signature. Pass `--verbose` for protocol details. Public
 * delivery is provider-managed; private delivery requires the Aleo recipient
 * to authorize the final mint.
 */

import { formatUnits, type Hex } from 'viem'
import { pathToFileURL } from 'node:url'
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
const DEFAULT_AMOUNT = '5'
const VERBOSE = process.argv.slice(2).includes('--verbose')

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function privateKey(): Hex {
  const value = required('EVM_PRIVATE_KEY').replace(/^0x/i, '')
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error('EVM_PRIVATE_KEY must contain exactly 32 hexadecimal bytes')
  }
  return `0x${value}`
}

function mintMode(): AleoMintMode {
  const value = process.env.USDCX_MINT_MODE?.trim() || 'public'
  if (value !== 'public' && value !== 'private') {
    throw new Error('USDCX_MINT_MODE must be public or private for the Arc example')
  }
  return value
}

function checkpoint(label: string, value: BridgeCheckpoint): void {
  if (VERBOSE) console.log(`${label}:`, JSON.stringify(value))
}

/**
 * Runs the Arc USDC to Aleo USDCx example.
 *
 * @param options Optional CLI overrides for the visible default amount and execution gate.
 * @returns After read-only inspection or destination delivery.
 */
export async function runArcToAleoExample(options: { amount?: string, execute?: boolean } = {}): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: pnpm tsx examples/bridge/arc-to-aleo.ts [--verbose]')
    return
  }

  const mode = mintMode()
  const amount = options.amount ?? DEFAULT_AMOUNT
  const recipient = required('ALEO_RECIPIENT')
  const account = evmPrivateKey(privateKey())
  if (account.type !== 'local') throw new Error('Expected a private-key EVM account')
  const privateMintSecretNonce = mode === 'private'
    ? `${process.env.USDCX_SECRET_NONCE?.replace(/scalar$/, '') || '0'}scalar`
    : undefined

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
      arc: createEvmClient({
        transport: evmHttp(required('ARC_RPC_URL')),
        account,
      }),
      ...(aleoClient ? { aleo: aleoClient } : {}),
    },
  })
  const plan = bridge.prepare({
    source: { chain: 'arc', asset: 'usdc' },
    destination: { chain: 'aleo', asset: 'usdcx' },
    bridgeProtocol: 'xreserve',
    amount,
    sender: account.account.address,
    recipient,
    mintMode: mode,
  })
  const quote = await bridge.quote({ plan, privateMintSecretNonce })
  if (quote.kind !== 'evm-xreserve') throw new Error(`Unexpected quote kind: ${quote.kind}`)

  console.log(`Arc sender: ${account.account.address}`)
  console.log(`Aleo recipient: ${recipient}`)
  console.log(`Amount: ${formatUnits(quote.amountAtomic, 6)} USDC (${mode} mint)`)
  if (VERBOSE) {
    console.table({
      route: plan.route.id,
      balance: `${formatUnits(quote.balanceAtomic, 6)} USDC`,
      allowance: `${formatUnits(quote.allowanceAtomic, 6)} USDC`,
      approvalRequired: quote.approvalRequired,
      recipientBytes32: quote.remoteRecipientBytes32,
      hookData: quote.hookData,
      maxFeeAtomic: quote.maxFeeAtomic.toString(),
    })
  }

  if (options.execute !== true && process.env[EXECUTION_ENVIRONMENT_VARIABLE] !== EXECUTION_ACKNOWLEDGEMENT) {
    console.log(`Set ${EXECUTION_ENVIRONMENT_VARIABLE}=${EXECUTION_ACKNOWLEDGEMENT} to approve and deposit USDC.`)
    return
  }

  let source = await bridge.execute({
    plan,
    privateMintSecretNonce,
    onCheckpoint(value) { checkpoint('source checkpoint', value) },
  })
  if (source.kind !== 'evm-xreserve') throw new Error(`Unexpected execution kind: ${source.kind}`)
  console.log('Arc deposit submitted:', source.receipt.sourceTxId)

  if (mode === 'public') {
    let receipt = await bridge.waitForStatus({
      plan,
      receipt: source.receipt,
      until: ['SOURCE_SUBMISSION_PENDING', 'DELIVERY_PENDING', 'FAILED'],
    })
    if (receipt.status === 'SOURCE_SUBMISSION_PENDING') {
      source = await bridge.resume({
        progress: { next: 'resume', plan, receipt },
        privateMintSecretNonce,
        onCheckpoint(value) { checkpoint('source checkpoint', value) },
      })
      receipt = await bridge.waitForStatus({
        plan,
        receipt: source.receipt,
        until: ['DELIVERY_PENDING', 'FAILED'],
      })
    }
    if (receipt.status === 'FAILED') {
      throw new Error(String(receipt.protocolState.sourceError ?? 'Bridge transfer failed'))
    }
    console.log('Circle attested the deposit; the public Aleo mint is relayer-driven.')
    return
  }

  let progress = await bridge.wait({ progress: { next: 'wait', plan, receipt: source.receipt } })
  if (progress.next === 'resume') {
    source = await bridge.resume({
      progress,
      privateMintSecretNonce,
      onCheckpoint(value) { checkpoint('source checkpoint', value) },
    })
    progress = await bridge.wait({ progress: { next: 'wait', plan, receipt: source.receipt } })
  }
  if (progress.next === 'failed') throw new Error(progress.error)
  if (progress.next !== 'complete') throw new Error(`Unexpected next operation: ${progress.next}`)

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runArcToAleoExample().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
