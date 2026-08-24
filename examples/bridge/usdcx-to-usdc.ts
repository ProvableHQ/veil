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
  createBridgeClient,
  type AleoBridgeExecutor,
  type XReserveBurnMode,
} from '@provablehq/veil-aleo-bridges'

const ROUTE_ID = 'xreserve:aleo/usdcx->ethereum/usdc'
const USDCX_PROGRAM = 'usdcx_stablecoin.aleo'
const FREEZE_LIST_URL = 'https://api.provable.com/v2/mainnet/programs/usdcx_freezelist.aleo/compliance/freeze-list'
const FREEZE_LIST_DEPTH = 15
const MINIMUM_BURN_AMOUNT_ATOMIC = 2_000_000n
const EXECUTION_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_BURNS_USDCX'
const ALEO_PROVING_PROGRESS_INTERVAL_MS = 15_000

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

function booleanFromEnvironment(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  if (!raw) return defaultValue
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error(`${name} must be true or false`)
}

function millisecondsFromEnvironment(name: string, defaultValue: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return defaultValue
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1_000) {
    throw new Error(`${name} must be an integer greater than or equal to 1000`)
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
  const amount = requiredEnvironmentVariable('USDCX_AMOUNT')
  const recipient = requiredEnvironmentVariable('ETHEREUM_RECIPIENT')
  const mode = burnModeFromEnvironment()
  const bridge = createBridgeClient({ environment: 'mainnet' })
  const plan = bridge.prepareTransfer({ routeId: ROUTE_ID, amount, recipient })
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

  if (process.env.EXECUTE_XRESERVE_BURN !== EXECUTION_ACKNOWLEDGEMENT) {
    console.log('\nPreflight complete; no USDCx was burned.')
    console.log(`Set EXECUTE_XRESERVE_BURN=${EXECUTION_ACKNOWLEDGEMENT} to submit the withdrawal.`)
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

  const provingMode = process.env.ALEO_PROVING_MODE?.trim() || 'delegated'
  if (provingMode !== 'delegated' && provingMode !== 'local') {
    throw new Error('ALEO_PROVING_MODE must be delegated or local')
  }
  const { loadNetwork } = await import('@provablehq/veil-aleo-sdk')
  const aleo = await loadNetwork('mainnet')
  const records = mode === 'private'
    ? aleo.createRemoteScanner({ consumerId: consumerId!, apiKey: apiKey! })
    : undefined
  const { walletClient, account } = aleo.createAleoClient({
    privateKey,
    networkUrl: process.env.ALEO_RPC_URL?.trim() || 'https://api.provable.com/v2',
    provingMode,
    ...(process.env.ALEO_PROVER_URL?.trim() ? { proverUrl: process.env.ALEO_PROVER_URL.trim() } : {}),
    ...(consumerId && apiKey ? { consumerId, apiKey } : {}),
    ...(records ? { records } : {}),
    useFeeMaster: booleanFromEnvironment('ALEO_USE_FEE_MASTER', true),
    confirmationTimeout: millisecondsFromEnvironment('ALEO_EXECUTION_CONFIRMATION_TIMEOUT_MS', 5 * 60_000),
  })
  if (consumerId && apiKey) await walletClient.authenticateProvableApi()
  console.log(`Aleo signer ready: ${account.address} (${provingMode} proving)`)

  const userRecord = mode === 'private'
    ? (await selectPrivateRecord(walletClient, amountAtomic)).recordPlaintext
    : undefined
  const merkleProof = mode === 'private'
    ? await createExclusionProof(account.address)
    : undefined
  if (merkleProof) console.log(`Derived the USDCx freeze-list exclusion proof for ${account.address}.`)

  const executor: AleoBridgeExecutor = {
    executeTransaction: async ({ program, function: functionName, inputs, privateFee, imports }) => {
      if (imports?.length) throw new Error('The local bridge executor does not accept dynamic import names')
      const startedAt = Date.now()
      const progress = setInterval(() => {
        console.log(`Aleo proving is still in progress (${Math.round((Date.now() - startedAt) / 1_000)}s elapsed).`)
      }, ALEO_PROVING_PROGRESS_INTERVAL_MS)
      try {
        const result = await walletClient.executeContract({
          program,
          function: functionName,
          inputs,
          privateFee,
        })
        return result.transactionId
      } finally {
        clearInterval(progress)
      }
    },
  }
  const burnMode: XReserveBurnMode = mode === 'private' ? 'private' : 'public-as-signer'
  const executingBridge = createBridgeClient({ environment: 'mainnet', executors: { aleo: executor } })
  const result = await executingBridge.executeXReserveBurn({
    plan,
    mode: burnMode,
    ...(userRecord ? { userRecord } : {}),
    ...(merkleProof ? { merkleProof } : {}),
    privateFee: booleanFromEnvironment('ALEO_PRIVATE_FEE', false),
  })
  console.log('\nUSDCx burn accepted:', result.transactionId)
  console.log('The Aleo burn-attestation service will forward the withdrawal to Circle for Ethereum delivery.')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
