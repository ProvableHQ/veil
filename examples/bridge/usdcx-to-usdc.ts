/**
 * Preflights or submits a mainnet Aleo USDCx burn for Ethereum USDC.
 *
 * Private burn is the default. The local wallet's record scanner finds and
 * decrypts the smallest unspent USDCx record that covers the withdrawal.
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
const FREEZE_LIST_URL = 'https://api.provable.com/v2/mainnet/programs/usdcx_freezelist.aleo/compliance/freeze-list'
const FREEZE_LIST_DEPTH = 15
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
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(amount)
  if (!match) throw new Error(`Invalid decimal amount: ${amount}`)
  const fraction = match[2] ?? ''
  if (fraction.length > decimals) throw new Error(`${amount} has more than ${decimals} decimal places`)
  return (BigInt(match[1]!) * (10n ** BigInt(decimals))) + BigInt(fraction.padEnd(decimals, '0') || '0')
}

function recordAmount(record: OwnedRecord): bigint | undefined {
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
  const records = await walletClient.requestRecords({
    program: USDCX_PROGRAM,
    statusFilter: 'unspent',
  }) as OwnedRecord[]

  let selected: { amount: bigint, record: OwnedRecord } | undefined
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

async function createExclusionProof(address: string): Promise<string> {
  const response = await fetch(FREEZE_LIST_URL)
  if (!response.ok) {
    throw new Error(`USDCx freeze-list request failed with HTTP ${response.status}`)
  }
  const payload: unknown = await response.json()
  if (!Array.isArray(payload) || payload.length === 0 || payload.some((value) => typeof value !== 'string' || !/^[0-9]+$/.test(value))) {
    throw new Error('USDCx freeze-list response must be a non-empty array of decimal strings')
  }

  const { SealanceMerkleTree } = await import('@provablehq/sdk/mainnet.js')
  const sealance = new SealanceMerkleTree()
  const tree = sealance.convertTreeToBigInt(payload as string[])
  const [leftIndex, rightIndex] = sealance.getLeafIndices(tree, address)
  const leftProof = sealance.getSiblingPath(tree, leftIndex, FREEZE_LIST_DEPTH)
  const rightProof = sealance.getSiblingPath(tree, rightIndex, FREEZE_LIST_DEPTH)
  return sealance.formatMerkleProof([leftProof, rightProof])
}

async function main(): Promise<void> {
  const recipient = requiredEnvironmentVariable('ETHEREUM_RECIPIENT')
  const mode = burnModeFromEnvironment()

  // ── The plan ────────────────────────────────────────────────────────
  // Planning needs no chain client. The registry resolves the Aleo burn
  // programs, Circle domains, withdrawal fee, and Ethereum USDC destination
  // from these structured endpoints. The amount is one atomic unit above the
  // fee so the minimum non-zero USDC withdrawal reaches Ethereum.
  const bridge = createBridgeClient({ environment: 'mainnet' })
  const plan = bridge.prepare({
    source: { chain: 'aleo', asset: 'usdcx' },
    destination: { chain: 'ethereum', asset: 'usdc' },
    bridgeProtocol: 'xreserve',
    amount: AMOUNT,
    recipient,
  })

  // ── The quote ───────────────────────────────────────────────────────
  // Aleo-origin xReserve has no separate source-side market quote. The registry
  // supplies the fixed withdrawal constraint, while Circle calculates live
  // forwarding data after the accepted burn. This preflight therefore displays
  // the exact amount, fee boundary, burn mode, and destination before any key is
  // loaded.
  const amountAtomic = atomicAmount(plan.amountIn, plan.sourceAsset.decimals)
  if (amountAtomic <= MINIMUM_BURN_AMOUNT_ATOMIC) {
    throw new Error('USDCx burn amount must be greater than 2 USDCx')
  }

  console.log('USDCx withdrawal preflight')
  console.table({
    route: plan.route.id,
    burnMode: mode,
    amount: `${plan.amountIn} USDCx`,
    amountAtomic: amountAtomic.toString(),
    ethereumRecipient: plan.recipient,
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

  // ── The execution ───────────────────────────────────────────────────
  // Stop before constructing a wallet unless the operator has reviewed the
  // preflight and supplied the common acknowledgement.
  if (process.env[EXECUTION_ENVIRONMENT_VARIABLE] !== EXECUTION_ACKNOWLEDGEMENT) {
    console.log('\nPreflight complete; no USDCx was burned.')
    console.log(`Set ${EXECUTION_ENVIRONMENT_VARIABLE}=${EXECUTION_ACKNOWLEDGEMENT} to submit the withdrawal.`)
    return
  }

  const privateKey = requiredEnvironmentVariable('ALEO_PRIVATE_KEY')
  const consumerId = process.env.ALEO_CONSUMER_ID?.trim()
  const apiKey = process.env.ALEO_DPS_API_KEY?.trim()
  if ((consumerId && !apiKey) || (!consumerId && apiKey)) {
    throw new Error('ALEO_CONSUMER_ID and ALEO_DPS_API_KEY must be supplied together')
  }
  if (mode === 'private' && (!consumerId || !apiKey)) {
    throw new Error('Private burn record discovery requires ALEO_CONSUMER_ID and ALEO_DPS_API_KEY')
  }

  // ── The clients ─────────────────────────────────────────────────────
  // The source wallet delegates proving and pays its own public execution fee.
  // Private mode also attaches a remote scanner because private USDCx exists as
  // records that cannot be discovered through a public address index.
  const { loadNetwork } = await import('@provablehq/veil-aleo-sdk')
  const aleo = await loadNetwork('mainnet')
  const records = mode === 'private'
    ? aleo.createRemoteScanner({ consumerId: consumerId!, apiKey: apiKey! })
    : undefined
  const { publicClient, walletClient: nativeWalletClient, account } = aleo.createAleoClient({
    privateKey,
    networkUrl: process.env.ALEO_RPC_URL?.trim() || 'https://api.provable.com/v2',
    provingMode: 'delegated',
    ...(consumerId && apiKey ? { consumerId, apiKey } : {}),
    ...(records ? { records } : {}),
    useFeeMaster: false,
    confirmationTimeout: ALEO_CONFIRMATION_TIMEOUT_MS,
  })
  if (consumerId && apiKey) await nativeWalletClient.authenticateProvableApi()
  console.log(`Aleo signer ready: ${account.address} (delegated proving)`)

  // A private burn spends one concrete record and proves that the signer is not
  // frozen. Select the smallest covering record to avoid consuming more private
  // value than necessary, then derive the current two-sided exclusion proof
  // from the published freeze list.
  const userRecord = mode === 'private'
    ? (await selectPrivateRecord(nativeWalletClient, amountAtomic)).recordPlaintext
    : undefined
  const merkleProof = mode === 'private'
    ? await createExclusionProof(account.address)
    : undefined
  if (merkleProof) console.log(`Derived the USDCx freeze-list exclusion proof for ${account.address}.`)

  const burnMode: XReserveBurnMode = mode === 'private' ? 'private' : 'public-as-signer'
  const executingBridge = createBridgeClient({
    environment: 'mainnet',
    clients: { aleo: createAleoClient({ publicClient, account: nativeWalletClient }) },
  })
  const result = await executingBridge.execute({
    plan,
    mode: burnMode,
    ...(userRecord ? { userRecord } : {}),
    ...(merkleProof ? { merkleProof } : {}),
    privateFee: false,
    onCheckpoint(checkpoint) {
      console.log('Optional recovery checkpoint:', JSON.stringify(checkpoint))
    },
  })
  if (result.kind !== 'aleo-xreserve') throw new Error(`Unexpected execution kind: ${result.kind}`)
  console.log('\nUSDCx burn accepted:', result.transactionId)

  // ── Settlement and recovery ─────────────────────────────────────────
  // The checkpoint identifies the submitted Aleo burn. This SDK can verify its
  // acceptance, but it does not yet expose status for the later attester,
  // Circle withdrawal, or Ethereum delivery. Stop at `DELIVERY_PENDING` rather
  // than calling `wait`, which is reserved for routes with complete destination
  // verification. Persisting the checkpoint remains an application decision.
  const receipt = await executingBridge.waitForStatus({
    plan,
    receipt: result.receipt,
    until: ['DELIVERY_PENDING', 'FAILED'],
  })
  if (receipt.status === 'FAILED') {
    throw new Error(String(receipt.protocolState.sourceError ?? 'Aleo burn failed'))
  }
  console.log('The Aleo burn-attestation service will forward the withdrawal to Circle for Ethereum delivery.')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
