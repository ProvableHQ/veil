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
  type BridgeReceipt,
} from '@provablehq/aleo-bridge-sdk'

const EXECUTION_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_MOVES_REAL_FUNDS'

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

function checkpoint(label: string, receipt: BridgeReceipt): void {
  // Store this JSON in durable application state before allowing the process
  // to continue. Passing it back prevents a crash from causing resubmission.
  console.log(`${label}:`, JSON.stringify(receipt))
}

async function main(): Promise<void> {
  const mode = mintMode()
  const recipient = required('ALEO_RECIPIENT')
  const evmAccount = evmPrivateKey(evmPrivateKeyFromEnvironment())
  if (evmAccount.type !== 'local') throw new Error('Expected a local EVM account')

  // A private mint needs an Aleo wallet because the caller submits the final
  // private_mint transition. Public and record mints are relayer-driven.
  let aleoClient: ReturnType<typeof createAleoClient> | undefined
  if (mode === 'private') {
    const { loadNetwork } = await import('@provablehq/veil-aleo-sdk')
    const network = await loadNetwork('mainnet')
    const aleo = network.createAleoClient({
      privateKey: required('ALEO_PRIVATE_KEY'),
      networkUrl: process.env.ALEO_RPC_URL?.trim() || 'https://api.provable.com/v2',
      provingMode: process.env.ALEO_PROVING_MODE === 'local' ? 'local' : 'delegated',
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

  // Callers select endpoints and optionally constrain the bridge protocol.
  // The canonical registry route id is an output on plan.route.id.
  const plan = bridge.prepare({
    source: { chain: 'ethereum', asset: 'usdc' },
    destination: { chain: 'aleo', asset: 'usdcx' },
    bridgeProtocol: 'xreserve',
    amount: required('USDC_AMOUNT'),
    recipient,
    sender: evmAccount.account.address,
    mintMode: mode,
    ...(process.env.USDCX_SECRET_NONCE
      ? { privateMintSecretNonce: `${process.env.USDCX_SECRET_NONCE.replace(/scalar$/, '')}scalar` }
      : {}),
  })

  // quote performs reads only. It never signs or submits.
  const transferQuote = await bridge.quote({ plan })
  if (transferQuote.kind !== 'evm-xreserve') throw new Error(`Unexpected quote kind: ${transferQuote.kind}`)
  console.table({
    route: plan.route.id,
    amount: `${formatUnits(transferQuote.amountAtomic, 6)} USDC`,
    balance: `${formatUnits(transferQuote.balanceAtomic, 6)} USDC`,
    allowance: `${formatUnits(transferQuote.allowanceAtomic, 6)} USDC`,
    approvalRequired: transferQuote.approvalRequired,
    mintMode: mode,
  })
  if (process.env.EXECUTE_XRESERVE_DEPOSIT !== EXECUTION_ACKNOWLEDGEMENT) return

  // execute submits only the source-side approval/deposit. Persist every
  // onSubmitted receipt atomically; a saved receipt can be passed as resume.
  const source = await bridge.execute({
    plan,
    onSubmitted(receipt) { checkpoint('source checkpoint', receipt) },
  })
  if (source.kind !== 'evm-xreserve') throw new Error(`Unexpected execution kind: ${source.kind}`)
  let receipt = source.receipt
  checkpoint('source result', receipt)
  if (receipt.status !== 'ATTESTATION_PENDING') {
    console.log('The source transaction is still confirming. Resume bridge.execute with this receipt.')
    return
  }

  // waitForStatus only reads Circle. It never submits a destination action.
  receipt = await bridge.waitForStatus({
    plan,
    receipt,
    until: [mode === 'private' ? 'DESTINATION_ACTION_REQUIRED' : 'DELIVERY_PENDING'],
    onUpdate(value) { checkpoint('attestation checkpoint', value) },
  })
  if (mode !== 'private') {
    console.log(`Circle attested the deposit; the ${mode} Aleo mint is relayer-driven.`)
    return
  }

  // complete is the explicit authorization boundary. It submits exactly one
  // destination transaction and checkpoints its id before confirmation reads.
  const destination = await bridge.complete({
    plan,
    receipt,
    privateFee: process.env.ALEO_PRIVATE_FEE === 'true',
    onSubmitted(value) { checkpoint('destination checkpoint', value) },
  })
  receipt = destination.receipt

  // The final wait is read-only and cannot submit private_mint a second time.
  receipt = await bridge.waitForStatus({
    plan,
    receipt,
    until: ['COMPLETED', 'FAILED'],
    onUpdate(value) { checkpoint('confirmation checkpoint', value) },
  })
  if (receipt.status === 'FAILED') throw new Error(`Aleo private mint failed: ${receipt.destinationTxId}`)
  console.log('Private USDCx mint completed:', receipt.destinationTxId)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
