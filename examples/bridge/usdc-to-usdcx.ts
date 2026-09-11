/**
 * Moves USDC from Ethereum into USDCx on Aleo through Circle xReserve.
 *
 * The default run reads the source balance, allowance, and route constraints,
 * then exits without requesting a signature. Public and record delivery is
 * completed by the bridge provider. Private delivery stops after Circle signs
 * the deposit so the Aleo recipient can authorize its own private mint.
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
  // Public credits a visible account balance. Record creates an Aleo record
  // through the provider. Private commits the recipient and an optional custom
  // nonce on Ethereum, then requires that recipient's wallet to mint privately.
  const value = process.env.USDCX_MINT_MODE?.trim() || 'public'
  if (value !== 'public' && value !== 'record' && value !== 'private') {
    throw new Error('USDCX_MINT_MODE must be public, record, or private')
  }
  return value
}

function checkpoint(label: string, value: BridgeCheckpoint): void {
  // A checkpoint contains the public transfer intent and any transaction ids
  // already submitted. It excludes signing keys and the private mint secret.
  // A durable application atomically replaces its latest saved value here;
  // this tutorial only prints it and does not choose or manage storage.
  console.log(`${label}:`, JSON.stringify(value))
}

async function main(): Promise<void> {
  const mode = mintMode()
  // The protocol defaults to 0scalar. A custom value adds caller-managed
  // entropy to the private commitment and must be stored separately because
  // recovery checkpoints intentionally omit it.
  const privateMintSecretNonce = mode === 'private'
    ? `${process.env.USDCX_SECRET_NONCE?.replace(/scalar$/, '') || '0'}scalar`
    : undefined
  const recipient = required('ALEO_RECIPIENT')
  const evmAccount = evmPrivateKey(evmPrivateKeyFromEnvironment())
  if (evmAccount.type !== 'local') throw new Error('Expected a private-key EVM account')

  // ── Connect the accounts that can authorize each fund movement ──────
  // The Ethereum account signs the approval, when needed, and the xReserve
  // deposit. Public and record modes need no Aleo account because the provider
  // submits their destination delivery. Private mode adds the recipient's Aleo
  // account, which delegates proof construction and signs the final private mint.
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
      // Only the committed recipient can complete a private mint. Catching a
      // mismatch before the Ethereum deposit avoids stranding funds at the
      // destination authorization boundary.
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

  // ── Describe the intended transfer ──────────────────────────────────
  // The caller supplies familiar chain and asset names, the amount, recipient,
  // and desired Aleo privacy mode. The bridge catalog supplies the reviewed
  // xReserve contract, Circle domains, token identifier, minimum amount, and
  // Aleo programs. No network is read and no wallet is asked to sign here.
  const plan = bridge.prepare({
    source: { chain: 'ethereum', asset: 'usdc' },
    destination: { chain: 'aleo', asset: 'usdcx' },
    bridgeProtocol: 'xreserve',
    amount: AMOUNT,
    recipient,
    sender: evmAccount.account.address,
    mintMode: mode,
  })

  // ── Check funds and destination constraints ─────────────────────────
  // Current Ethereum reads confirm the USDC balance and allowance and construct
  // the data xReserve will commit for Aleo delivery. They do not request a
  // signature or move USDC. For a private mint, a custom nonce changes that
  // commitment and must be retained separately for recovery and final delivery.
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
  // A normal run ends after displaying the amount, balance, allowance, and
  // privacy mode. The exact acknowledgement makes the irreversible mainnet
  // deposit an explicit operator decision.
  if (process.env[EXECUTION_ENVIRONMENT_VARIABLE] !== EXECUTION_ACKNOWLEDGEMENT) {
    console.log(`Set ${EXECUTION_ENVIRONMENT_VARIABLE}=${EXECUTION_ACKNOWLEDGEMENT} to approve and deposit USDC.`)
    return
  }

  // ── Commit USDC to the bridge ───────────────────────────────────────
  // An approval permits only the reviewed xReserve contract to spend this
  // amount and does not itself move USDC. The following deposit transfers
  // custody to xReserve and commits the Aleo recipient and mint mode. Once its
  // transaction is broadcast, retry by recovery state rather than redepositing.
  let source = await bridge.execute({
    plan,
    privateMintSecretNonce,
    onCheckpoint(value) { checkpoint('source checkpoint', value) },
  })
  if (source.kind !== 'evm-xreserve') throw new Error(`Unexpected execution kind: ${source.kind}`)

  // ── Follow source finality and Circle attestation ───────────────────
  // Monitoring verifies the exact xReserve deposit event, derives its Circle
  // message hash, and waits for Circle's signature. A missing attestation is
  // pending, not failed. A timeout or provider error after broadcast does not
  // undo the deposit; recover from the latest checkpoint instead of resubmitting.
  if (mode !== 'private') {
    // Provider-managed mints have no destination transaction that this toolkit
    // can verify. Stop at the observable boundary instead of waiting forever
    // for a completion state the provider does not expose.
    let receipt = await bridge.waitForStatus({
      plan,
      receipt: source.receipt,
      until: ['SOURCE_SUBMISSION_PENDING', 'DELIVERY_PENDING', 'FAILED'],
    })
    if (receipt.status === 'SOURCE_SUBMISSION_PENDING') {
      // This state means an approval confirmed but no deposit was submitted.
      // Resuming requests authorization for the remaining deposit only and
      // never repeats the confirmed approval.
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
    // Circle has authorized destination delivery. The provider now submits the
    // public or record mint; this toolkit cannot yet verify that provider-owned
    // Aleo transaction, so the script reports the honest observable boundary.
    console.log(`Circle attested the deposit; the ${mode} Aleo mint is relayer-driven.`)
    return
  }

  let progress = await bridge.wait({ progress: { next: 'wait', plan, receipt: source.receipt } })
  if (progress.next === 'resume') {
    // This state means an approval confirmed but no deposit was submitted.
    // Resuming requests authorization for the remaining deposit only and never
    // repeats the confirmed approval.
    source = await bridge.resume({
      progress,
      privateMintSecretNonce,
      onCheckpoint(value) { checkpoint('source checkpoint', value) },
    })
    progress = await bridge.wait({ progress: { next: 'wait', plan, receipt: source.receipt } })
  }
  if (progress.next === 'failed') throw new Error(progress.error)
  if (progress.next !== 'complete') throw new Error(`Unexpected next operation: ${progress.next}`)

  // ── Authorize private delivery on Aleo ───────────────────────────────
  // Circle's signature proves that xReserve accepted the Ethereum deposit, but
  // it does not mint a private record. The recipient now supplies the same
  // nonce committed on Ethereum and signs exactly one Aleo mint. The source
  // deposit is never repeated, even if destination proving or confirmation fails.
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
