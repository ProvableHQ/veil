import { resolve } from 'node:path'
import { homedir } from 'node:os'
import type { Address, Hex } from 'viem'
import { openWithdrawalState } from './withdrawal-state.js'
import { pathToFileURL } from 'node:url'
import { aleoExampleOptions, serviceAuth, type ExampleOptions } from './options.js'
/**
 * Moves USDCx from Aleo back to USDC on Ethereum or Arc through Circle xReserve.
 *
 * The default run displays the route, fixed withdrawal boundary, and burn mode,
 * then exits before loading a signing key. Execution burns either a public
 * balance or one private record on Aleo. The bridge provider then attests the
 * burn, withdraws through Circle, and delivers USDC to the selected EVM recipient.
 */

import {
  parseRecord,
  type OwnedRecord,
} from '@provablehq/veil-core'
import {
  createAleoClient,
  createBridgeClient,
  type XReserveBurnMode,
} from '@provablehq/aleo-bridge-sdk'

const USDCX_PROGRAM = 'usdcx_stablecoin.aleo'
const MINIMUM_BURN_AMOUNT_ATOMIC = 2_000_000n
const EXECUTION_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_MOVES_REAL_FUNDS'
const EXECUTION_ENVIRONMENT_VARIABLE = 'EXECUTE_BRIDGE'
const ALEO_CONFIRMATION_TIMEOUT_MS = 5 * 60_000
const AMOUNT = '2.000001'

type ExampleBurnMode = 'private' | 'public'

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function burnModeFromEnvironment(): ExampleBurnMode {
  const value = process.env.USDCX_BURN_MODE?.trim() || 'private'
  if (value !== 'private' && value !== 'public') {
    throw new Error('USDCX_BURN_MODE must be private or public')
  }
  return value
}

function atomicAmount(amount: string, decimals: number): bigint {
  // Bridge contracts accept integer base units, not floating-point values.
  // Convert the reviewed decimal text exactly and reject precision the token
  // cannot represent. This calculation reads no network and moves no funds.
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(amount)
  if (!match) throw new Error(`Invalid decimal amount: ${amount}`)
  const fraction = match[2] ?? ''
  if (fraction.length > decimals) throw new Error(`${amount} has more than ${decimals} decimal places`)
  return (BigInt(match[1]!) * (10n ** BigInt(decimals))) + BigInt(fraction.padEnd(decimals, '0') || '0')
}

function recordAmount(record: OwnedRecord): bigint | undefined {
  // Scanner results may contain other record names or stale malformed entries.
  // Ignore those candidates rather than treating unreadable data as spendable.
  if (record.recordName && record.recordName !== 'Token') return undefined
  try {
    const amount = parseRecord(record.recordPlaintext).fields.amount?.value
    return typeof amount === 'bigint' ? amount : undefined
  } catch {
    return undefined
  }
}

async function selectPrivateRecord(
  walletClient: { requestRecords: (params: { program: string, statusFilter: 'unspent' }) => Promise<unknown[]> },
  minimumAmount: bigint,
): Promise<OwnedRecord> {
  // Aleo does not publish private record ownership in an address index. The
  // authenticated scanner finds records belonging to this account and returns
  // their decrypted plaintext so the wallet can choose a concrete spend input.
  const records = await walletClient.requestRecords({
    program: USDCX_PROGRAM,
    statusFilter: 'unspent',
  }) as OwnedRecord[]

  let selected: { amount: bigint, record: OwnedRecord } | undefined
  // One private burn consumes one record; it does not combine several small
  // records automatically. Choose the smallest single record that covers the
  // withdrawal to avoid consuming more private value than necessary.
  for (const record of records) {
    const amount = recordAmount(record)
    if (amount === undefined || amount < minimumAmount) continue
    if (!selected || amount < selected.amount) selected = { amount, record }
  }
  if (!selected) {
    throw new Error(
      `No unspent ${USDCX_PROGRAM}/Token record covers ${minimumAmount} base units; ` +
      'the private balance is too low, still indexing, or held across records that must first be joined.',
    )
  }
  console.log(`Selected a private USDCx record containing ${selected.amount} base units.`)
  return selected.record
}

/**
 * Runs the usdcx-to-usdc mainnet journey with a preview before submission.
 * @param options Overrides destination, amount, and execution gate. Destination defaults to Ethereum; Arc uses a two-USDCx default amount. Execution defaults to the environment acknowledgement.
 * @returns Resolves after preview or the selected transfer lifecycle.
 * @throws When configuration, protocol validation, or delivery fails.
 * @example
 * await runUsdcxToUsdcExample({ amount: '5', execute: false })
 */
export async function runUsdcxToUsdcExample(options: ExampleOptions & { destination?: 'ethereum' | 'arc' } = {}): Promise<void> {
  const destination = options.destination ?? 'ethereum'
  if (destination !== 'ethereum' && destination !== 'arc') throw new Error('Destination must be ethereum or arc')
  const recipient = requiredEnvironmentVariable(destination === 'arc' ? 'ARC_RECIPIENT' : 'ETHEREUM_RECIPIENT')
  const mode = burnModeFromEnvironment()

  // ── Price the intended transfer ─────────────────────────────────────
  // Arc uses a live fee estimate; Ethereum retains its configured fee.
  // Pass destination: 'arc' and set ARC_RECIPIENT for the reverse Arc route.
  const bridge = createBridgeClient({ environment: 'mainnet' })
  const quote = await bridge.quote({
    source: { chain: 'aleo', asset: 'usdcx' },
    destination: { chain: destination, asset: 'usdc' },
    bridgeProtocol: 'xreserve',
    amount: options.amount ?? (destination === 'arc' ? '2' : AMOUNT),
    recipient,
  })
  if (quote.kind !== 'aleo-xreserve') throw new Error(`Unexpected quote kind: ${quote.kind}`)
  const plan = quote.plan

  // ── Review the withdrawal before loading an account ─────────────────
  // Display the amount, public or private custody being spent, and final
  // EVM recipient before loading any key or private record.
  const amountAtomic = atomicAmount(plan.amountIn, plan.sourceAsset.decimals)
  if (amountAtomic < MINIMUM_BURN_AMOUNT_ATOMIC) {
    throw new Error('USDCx burn amount must be at least 2 USDCx')
  }

  console.log('USDCx withdrawal preflight')
  console.table({
    route: plan.route.id,
    burnMode: mode,
    amount: `${plan.amountIn} USDCx`,
    amountAtomic: amountAtomic.toString(),
    evmRecipient: plan.recipient,
    sourceOperation: mode === 'private'
      ? 'shielded_usdcx_wrapper.aleo/private_burn'
      : 'usdcx_bridge_v2.aleo/burn_public_as_signer',
    recordSelection: mode === 'private'
      ? `smallest unspent ${USDCX_PROGRAM}/Token record covering the amount`
      : 'not used',
    complianceProof: mode === 'private'
      ? 'fetched and derived for the Aleo signer at execution'
      : 'not used',
  })

  // ── Stop before the fund-moving boundary by default ─────────────────
  // The exact acknowledgement separates inspection from an irreversible Aleo
  // burn. A copied tutorial therefore cannot load private records, request a
  // proof, spend a fee, or destroy USDCx without an explicit operator decision.
  if (!(options.execute ?? (process.env[EXECUTION_ENVIRONMENT_VARIABLE] === EXECUTION_ACKNOWLEDGEMENT))) {
    console.log('\nPreflight complete; no USDCx was burned.')
    console.log(`Set ${EXECUTION_ENVIRONMENT_VARIABLE}=${EXECUTION_ACKNOWLEDGEMENT} to submit the withdrawal.`)
    return
  }

  const privateKey = requiredEnvironmentVariable('ALEO_PRIVATE_KEY')

  // ── Connect the account that owns the source funds ───────────────────
  // The Aleo account delegates proof construction, signs the finished proof,
  // broadcasts the burn, and pays the transaction fee from public credits.
  // Private mode also attaches a remote scanner because record ownership is
  // encrypted and cannot be discovered from ordinary public chain reads. The
  // Provable gateway needs no credentials, and neither service receives the
  // Aleo private key.
  const { loadNetwork } = await import('@provablehq/veil-aleo-sdk')
  const aleo = await loadNetwork('mainnet')
  const records = mode === 'private' ? aleo.createRemoteScanner({ ...serviceAuth(), url: process.env.ALEO_SCANNER_URL?.trim() || undefined }) : undefined
  const { publicClient, walletClient: nativeWalletClient, account } = aleo.createAleoClient({
    privateKey,
    networkUrl: process.env.ALEO_RPC_URL?.trim() || 'https://edge.provable.com/api/v2',
    ...aleoExampleOptions(),
    ...(records ? { records } : {}),
    useFeeMaster: false,
    confirmationTimeout: ALEO_CONFIRMATION_TIMEOUT_MS,
  })
  console.log(`Aleo signer ready: ${account.address} (delegated proving)`)

  const tracker = destination === 'ethereum' ? await openWithdrawalState(
    resolve(process.env.WITHDRAWAL_STATE_FILE?.trim() || `${homedir()}/.local/state/veil/examples/usdcx-to-ethereum.json`),
    JSON.stringify({ route: plan.route.id, sender: String(account.address), recipient: plan.recipient, amount: plan.amountIn, mode }),
    requiredEnvironmentVariable('ETHEREUM_RPC_URL'),
    { reserve: plan.route.metadata!.xReserveContract as Address, token: plan.destinationAsset.locator!.value as Address,
      recipient: plan.recipient as Address, remoteDomain: plan.route.metadata!.remoteDomain as number,
      remoteToken: plan.route.metadata!.remoteTokenBytes32 as Hex,
      minimum: atomicAmount(quote.amountOut ?? '0.000001', 6), maximum: amountAtomic },
  ) : undefined
  try {
    if (tracker?.delivered) { console.log('Previously observed Ethereum delivery:', tracker.delivered); return }
    // A private burn spends one concrete record and proves that the signer is not
    // frozen. Bridge constructs and verifies the compliance proof automatically
    // before submission; the caller only selects the spendable record.
    const userRecord = !tracker?.checkpoint && mode === 'private'
      ? (await selectPrivateRecord(nativeWalletClient, amountAtomic)).recordPlaintext
      : undefined

    // xReserve can burn the selected USDCx record directly. Do not unshield it
    // first: that would create a separate public balance and add an unnecessary
    // Aleo transaction before the withdrawal.

    const burnMode: XReserveBurnMode = mode === 'private' ? 'private' : 'public-as-signer'
    const executingBridge = createBridgeClient({
      environment: 'mainnet',
      clients: { aleo: createAleoClient({ publicClient, account: nativeWalletClient }) },
    })
    // This Aleo transaction is the irreversible source boundary. Acceptance means
    // the chosen public balance or private record was burned and the withdrawal
    // was committed for the EVM recipient. The provider and Circle continue
    // from that accepted burn; never burn a second time because polling failed.
    const persist = (checkpoint: import('@provablehq/aleo-bridge-sdk').BridgeCheckpoint) => {
      tracker?.persist(checkpoint)
      console.log('Optional recovery checkpoint:', JSON.stringify(checkpoint))
    }
    let progress
    if (tracker?.checkpoint) {
      progress = await executingBridge.recover({ checkpoint: tracker.checkpoint })
      if (progress.next === 'resume') {
        const resumed = await executingBridge.resume({ progress, onCheckpoint: persist })
        progress = { next: 'wait' as const, plan: progress.plan, receipt: resumed.receipt }
      }
    } else {
      tracker?.begin()
      const result = await executingBridge.execute({ plan, mode: burnMode,
        ...(userRecord ? { userRecord } : {}),
        privateFee: false, onCheckpoint: persist })
      if (result.kind !== 'aleo-xreserve') throw new Error(`Unexpected execution kind: ${result.kind}`)
      console.log('USDCx burn submitted:', result.transactionId)
      progress = { next: 'wait' as const, plan, receipt: result.receipt }
    }
    progress = await executingBridge.wait({ progress, until: ['DELIVERY_PENDING', 'FAILED'] })
    if (progress.next === 'failed') throw new Error(progress.error)
    if (tracker) { await tracker.wait(); return }
    console.log('The Aleo burn-attestation service will forward the withdrawal to Circle for delivery on the selected EVM chain.')
  } finally { tracker?.release() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
runUsdcxToUsdcExample().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
}
