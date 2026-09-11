/**
 * Moves USDCx from Aleo back to USDC on Ethereum through Circle xReserve.
 *
 * The default run displays the route, fixed withdrawal boundary, and burn mode,
 * then exits before loading a signing key. Execution burns either a public
 * balance or one private record on Aleo. The bridge provider then attests the
 * burn, withdraws through Circle, and delivers USDC to the Ethereum recipient.
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

async function createExclusionProof(address: string): Promise<string> {
  // Private USDCx must prove the signer is absent from the current freeze list.
  // Refuse missing or malformed provider data before proving, because an old or
  // invented list is not a valid statement about current compliance state.
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
  // The neighboring leaves on both sides of the address prove its absence from
  // the ordered tree. The Aleo program checks these sibling paths during burn.
  const [leftIndex, rightIndex] = sealance.getLeafIndices(tree, address)
  const leftProof = sealance.getSiblingPath(tree, leftIndex, FREEZE_LIST_DEPTH)
  const rightProof = sealance.getSiblingPath(tree, rightIndex, FREEZE_LIST_DEPTH)
  return sealance.formatMerkleProof([leftProof, rightProof])
}

async function main(): Promise<void> {
  const recipient = requiredEnvironmentVariable('ETHEREUM_RECIPIENT')
  const mode = burnModeFromEnvironment()

  // ── Describe the intended transfer ──────────────────────────────────
  // The caller supplies familiar chain and asset names, the amount, and the
  // Ethereum recipient. The bridge catalog supplies the reviewed Aleo programs,
  // Circle domains, token identifiers, and fixed two-USDCx withdrawal boundary.
  // No network is read and no wallet is involved here. This amount is one base
  // unit above that boundary so the example moves the minimum possible value.
  const bridge = createBridgeClient({ environment: 'mainnet' })
  const plan = bridge.prepare({
    source: { chain: 'aleo', asset: 'usdcx' },
    destination: { chain: 'ethereum', asset: 'usdc' },
    bridgeProtocol: 'xreserve',
    amount: AMOUNT,
    recipient,
  })

  // ── Review the withdrawal before loading an account ─────────────────
  // This direction has no live source-side market quote. The important caller
  // choices are the amount, public or private custody being spent, and final
  // Ethereum recipient. Display them before any key or private record is loaded.
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

  // ── Stop before the fund-moving boundary by default ─────────────────
  // The exact acknowledgement separates inspection from an irreversible Aleo
  // burn. A copied tutorial therefore cannot load private records, request a
  // proof, spend a fee, or destroy USDCx without an explicit operator decision.
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

  // ── Connect the account that owns the source funds ───────────────────
  // The Aleo account delegates proof construction, signs the finished proof,
  // broadcasts the burn, and pays the transaction fee from public credits.
  // Private mode also authenticates a remote scanner because record ownership
  // is encrypted and cannot be discovered from ordinary public chain reads.
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
  // Authentication lets the delegated prover and scanner act for this account;
  // neither service receives the Aleo private key.
  if (consumerId && apiKey) await nativeWalletClient.authenticateProvableApi()
  console.log(`Aleo signer ready: ${account.address} (delegated proving)`)

  // A private burn spends one concrete record and proves that the signer is not
  // frozen. Record discovery and the freeze-list request happen before proving;
  // failure here means no burn was submitted and no USDCx moved.
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
  // This Aleo transaction is the irreversible source boundary. Acceptance means
  // the chosen public balance or private record was burned and the withdrawal
  // was committed for the Ethereum recipient. The provider and Circle continue
  // from that accepted burn; never burn a second time because polling failed.
  const result = await executingBridge.execute({
    plan,
    mode: burnMode,
    ...(userRecord ? { userRecord } : {}),
    ...(merkleProof ? { merkleProof } : {}),
    privateFee: false,
    onCheckpoint(checkpoint) {
      // Aleo may emit a checkpoint after proof construction and another after
      // broadcast. A durable application atomically replaces its saved value;
      // this tutorial only prints it and does not choose or manage storage.
      console.log('Optional recovery checkpoint:', JSON.stringify(checkpoint))
    },
  })
  if (result.kind !== 'aleo-xreserve') throw new Error(`Unexpected execution kind: ${result.kind}`)
  console.log('\nUSDCx burn accepted:', result.transactionId)

  // ── Verify the source burn and hand off provider settlement ─────────
  // The toolkit can prove that Aleo accepted or rejected this burn. It cannot
  // yet observe the later bridge-provider attestation, Circle withdrawal, or
  // Ethereum delivery, so this script stops honestly at delivery pending. A
  // timeout or RPC error leaves the burn outcome unknown; recover from the
  // latest checkpoint and transaction id instead of authorizing another burn.
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
