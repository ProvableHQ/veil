import { parsePlaintextValue, readContract, type Client } from '@provablehq/veil-core'
import { BridgeError } from '../../errors/bridgeErrors.js'
import type {
  AleoWalletClient,
  AleoHyperlaneGasQuote,
  AleoHyperlaneTransferRemoteCall,
  AleoHyperlaneTransferRemoteExecution,
  ExecuteAleoHyperlaneTransferRemoteParameters,
  QuoteAleoHyperlaneGasPaymentParameters,
} from '../../types/aleo.js'
import type { BridgeRegistry, BridgeReceipt, ProtocolBridgeRoute } from '../../types/protocol.js'
import {
  evmAddressToAleoHyperlaneRecipient,
  solanaAddressToAleoHyperlaneRecipient,
} from '../../utils/hyperlane.js'
import { parseDecimalAmount } from '../../utils/units.js'

const MAX_U64 = (1n << 64n) - 1n
// Divisor and zero-gas-limit fallback fixed by hyp_hook_manager.aleo post_dispatch.
const GAS_QUOTE_SCALE = 10_000_000_000n
const ZERO_GAS_LIMIT_FALLBACK = 50_000n

const PLACEHOLDER_FIELDS = [
  'aleoTokenType',
  'aleoTokenOwner',
  'aleoIsm',
  'aleoHook',
  'aleoTokenId',
  'aleoMailboxDefaultHook',
  'aleoMailboxRequiredHook',
  'aleoRemoteRouterRecipient',
  'aleoRemoteRouterGas',
  'aleoRecipient',
  'aleoAllowanceSpender0',
  'aleoAllowanceAmount0',
  'aleoAllowanceSpender1',
  'aleoAllowanceAmount1',
  'aleoAllowanceSpender2',
  'aleoAllowanceAmount2',
  'aleoAllowanceSpender3',
  'aleoAllowanceAmount3',
] as const

const APP_METADATA_FIELDS = new Set<string>([
  'aleoTokenType',
  'aleoTokenOwner',
  'aleoIsm',
  'aleoHook',
  'aleoTokenId',
])

const MAILBOX_STATE_FIELDS = new Set<string>([
  'aleoMailboxDefaultHook',
  'aleoMailboxRequiredHook',
])

const REMOTE_ROUTER_FIELDS = new Set<string>([
  'aleoRemoteRouterRecipient',
  'aleoRemoteRouterGas',
])

const ALLOWANCE_SPENDER_FIELDS = new Set<string>([
  'aleoAllowanceSpender0',
  'aleoAllowanceSpender1',
  'aleoAllowanceSpender2',
  'aleoAllowanceSpender3',
])

const UNUSED_ALLOWANCE_AMOUNT_FIELDS = new Set<string>([
  'aleoAllowanceAmount1',
  'aleoAllowanceAmount2',
  'aleoAllowanceAmount3',
])

function metadataString(route: ProtocolBridgeRoute, key: string): string {
  const value = route.metadata?.[key]
  if (typeof value !== 'string' || value.length === 0) throw new BridgeError(`Hyperlane route metadata ${key} is missing: ${route.id}`)
  return value
}

function metadataNumber(route: ProtocolBridgeRoute, key: string): number {
  const value = route.metadata?.[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new BridgeError(`Hyperlane route metadata ${key} is invalid: ${route.id}`)
  return value
}

function optionalMetadataNumber(route: ProtocolBridgeRoute, key: string, fallback: number): number {
  return route.metadata?.[key] == null ? fallback : metadataNumber(route, key)
}

function validatedRoute(registry: BridgeRegistry, params: ExecuteAleoHyperlaneTransferRemoteParameters) {
  const { plan } = params
  if (plan.protocol !== 'hyperlane' || plan.route.protocol !== 'hyperlane') throw new BridgeError('Aleo transfer_remote requires a Hyperlane transfer plan')
  if (plan.registryVersion !== registry.version) throw new BridgeError(`Transfer plan uses registry ${plan.registryVersion}; expected ${registry.version}`)
  // Reload the deployed programs and remote-domain configuration from the
  // current reviewed registry before constructing wallet inputs.
  const route = registry.routes.find((entry) => entry.id === plan.route.id)
  if (!route || route.protocol !== 'hyperlane') throw new BridgeError(`Hyperlane route is not configured: ${plan.route.id}`)
  if (route.sourceAssetId !== plan.sourceAsset.id || route.destinationAssetId !== plan.destinationAsset.id) throw new BridgeError(`Transfer plan assets do not match configured route: ${route.id}`)
  const sourceChain = registry.chains.find((chain) => chain.id === plan.sourceAsset.chainId)
  if (sourceChain?.family !== 'aleo') throw new BridgeError('transfer_remote requires an Aleo source asset')
  const destinationChain = registry.chains.find((chain) => chain.id === plan.destinationAsset.chainId)
  if (!destinationChain) throw new BridgeError(`Destination chain is not configured: ${plan.destinationAsset.chainId}`)
  const program = metadataString(route, 'aleoRouterProgram')
  if (!program.endsWith('.aleo')) throw new BridgeError(`Aleo Warp Route program is invalid: ${route.id}`)
  return { route, program, destinationChain }
}

function allowance(route: ProtocolBridgeRoute, index: number, amountOverride?: string): string {
  const amount = amountOverride ?? metadataString(route, `aleoAllowanceAmount${index}`)
  return `{ spender: ${metadataString(route, `aleoAllowanceSpender${index}`)}, amount: ${amount}u64 }`
}

function gasConfigBigint(config: Record<string, unknown>, field: string, routeId: string): bigint {
  const value = config[field]
  if (typeof value !== 'bigint' || value < 0n) throw new BridgeError(`Hyperlane gas configuration field ${field} is invalid: ${routeId}`)
  return value
}

/**
 * Calculates the relayer payment required for a Hyperlane transfer leaving Aleo.
 *
 * The payment covers destination-chain delivery rather than the Aleo
 * transaction fee. It is calculated from the gas oracle values enforced by
 * the bridge program at finalization:
 * `(gas_limit + gas_overhead) * gas_price * exchange_rate / 10^10`.
 * Quote shortly before submission because a stale value causes the source
 * transaction to fail. The action reads Aleo but does not request a signature
 * or move funds.
 *
 * @param registry Supported assets and reviewed Hyperlane deployments.
 * @param client Aleo network access used to read the current destination gas configuration.
 * @param params Aleo-origin route whose destination delivery payment is calculated.
 * @returns Current gas values and the exact relayer payment in Aleo microcredits (u64).
 * @throws BridgeError When the route is unavailable, the on-chain gas configuration is missing or unpriced, or the payment cannot fit in a positive u64.
 *
 * @example
 * const result = await quote(registry, client, { routeId: plan.route.id })
 */
export async function quote(
  registry: BridgeRegistry,
  client: Client,
  params: QuoteAleoHyperlaneGasPaymentParameters,
): Promise<AleoHyperlaneGasQuote> {
  // The route tells the hook manager which IGP and destination-domain tuple is
  // authoritative for this transfer.
  const route = registry.routes.find((entry) => entry.id === params.routeId)
  if (!route || route.protocol !== 'hyperlane') throw new BridgeError(`Hyperlane route is not configured: ${params.routeId}`)
  const sourceAsset = registry.assets.find((asset) => asset.id === route.sourceAssetId)
  const sourceChain = registry.chains.find((chain) => chain.id === sourceAsset?.chainId)
  if (sourceChain?.family !== 'aleo') throw new BridgeError(`Hyperlane gas quotes require an Aleo source asset: ${params.routeId}`)
  const hookManager = metadataString(route, 'aleoHookManagerProgram')
  const igp = metadataString(route, 'aleoMailboxDefaultHook')
  const destination = metadataNumber(route, 'aleoDestinationDomain')
  const gasLimitMetadata = BigInt(metadataString(route, 'aleoRemoteRouterGas'))
  // Read the same mapping entry consumed by hyp_hook_manager.aleo during
  // finalization; an off-chain service quote would not be authoritative.
  const literal = await readContract(client, {
    programId: hookManager,
    mapping: 'destination_gas_configs',
    key: `{ igp: ${igp}, destination: ${destination}u32 }`,
  })
  if (literal == null) throw new BridgeError(`Hyperlane destination gas configuration is missing on chain: ${params.routeId}`)
  const config = parsePlaintextValue(literal)
  if (typeof config !== 'object' || Array.isArray(config)) throw new BridgeError(`Hyperlane destination gas configuration is malformed: ${params.routeId}`)
  // A zero exchange rate or gas price means the destination is configured but
  // cannot currently be priced, so submission would be unsafe.
  const gasOverhead = gasConfigBigint(config, 'gas_overhead', route.id)
  const exchangeRate = gasConfigBigint(config, 'exchange_rate', route.id)
  const gasPrice = gasConfigBigint(config, 'gas_price', route.id)
  if (exchangeRate === 0n || gasPrice === 0n) throw new BridgeError(`Hyperlane destination gas configuration is unpriced: ${params.routeId}`)
  const gasLimit = gasLimitMetadata === 0n ? ZERO_GAS_LIMIT_FALLBACK : gasLimitMetadata
  // Preserve integer operation order and truncation so every language port
  // reproduces the exact u64 amount checked by the Aleo program.
  const paymentMicrocredits = ((gasLimit + gasOverhead) * gasPrice * exchangeRate) / GAS_QUOTE_SCALE
  if (paymentMicrocredits <= 0n || paymentMicrocredits > MAX_U64) {
    throw new BridgeError(`Hyperlane hook payment does not fit a positive u64: ${paymentMicrocredits}`)
  }
  return {
    routeId: route.id,
    gasLimit,
    gasOverhead,
    gasPrice,
    exchangeRate,
    paymentMicrocredits,
    // A public quote cannot authorize the program execution needed to price
    // its Aleo network fee. Keep the absent total explicit so callers do not
    // mistake the Hyperlane hook payment for their complete balance need.
    executionFeeMicrocredits: null,
    totalMicrocredits: null,
  }
}

/**
 * Builds the Aleo program call that commits an asset to a Hyperlane transfer.
 *
 * The result lets an application inspect the program, transition, amount, remote
 * recipient, and relayer allowance before a wallet is involved. It does not
 * contact Aleo, request a signature, or move funds. Routes still under review
 * return named placeholder fields and MUST NOT be submitted.
 *
 * @param registry Supported assets and reviewed Hyperlane deployments.
 * @param params Route, assets, amount, recipient, authorization mode, and optional current relayer payment.
 * @returns Exact Aleo program, transition, ordered inputs, atomic amount, and any configuration that is not ready for submission.
 * @throws BridgeError When the transfer conflicts with the deployment or the relayer payment cannot fit in a positive u64.
 *
 * @example
 * const call = buildTransferRemoteCall(registry, { plan })
 */
export function buildTransferRemoteCall(
  registry: BridgeRegistry,
  params: ExecuteAleoHyperlaneTransferRemoteParameters,
): AleoHyperlaneTransferRemoteCall {
  if (params.mode != null && params.mode !== 'caller' && params.mode !== 'signer') {
    throw new BridgeError(`Unsupported Aleo Hyperlane transfer mode: ${String(params.mode)}`)
  }
  const gasPayment = params.gasPaymentMicrocredits
  if (gasPayment != null && (gasPayment <= 0n || gasPayment > MAX_U64)) {
    throw new BridgeError(`gasPaymentMicrocredits must be a positive u64: ${gasPayment}`)
  }
  const { route, program, destinationChain } = validatedRoute(registry, params)
  const amountAtomic = parseDecimalAmount(params.plan.amountIn, params.plan.sourceAsset.decimals)
  const destination = metadataNumber(route, 'aleoDestinationDomain')
  const localDecimals = optionalMetadataNumber(route, 'aleoLocalDecimals', params.plan.sourceAsset.decimals)
  const remoteDecimals = optionalMetadataNumber(route, 'aleoRemoteDecimals', params.plan.destinationAsset.decimals)
  // Freeze the reviewed route into the three Aleo structs the Warp Route checks:
  // token configuration, Mailbox hooks, and the enrolled remote router.
  const appMetadata = `{ token_type: ${metadataString(route, 'aleoTokenType')}u8, token_owner: ${metadataString(route, 'aleoTokenOwner')}, ism: ${metadataString(route, 'aleoIsm')}, hook: ${metadataString(route, 'aleoHook')}, token_id: ${metadataString(route, 'aleoTokenId')}, local_decimals: ${localDecimals}u8, remote_decimals: ${remoteDecimals}u8 }`
  const mailboxState = `{ default_hook: ${metadataString(route, 'aleoMailboxDefaultHook')}, required_hook: ${metadataString(route, 'aleoMailboxRequiredHook')} }`
  const remoteRouter = `{ domain: ${destination}u32, recipient: ${metadataString(route, 'aleoRemoteRouterRecipient')}, gas: ${metadataString(route, 'aleoRemoteRouterGas')}u128 }`
  // Aleo represents a 32-byte remote recipient as two little-endian u128 limbs.
  // EVM addresses are left-padded to 32 bytes; Solana public keys already occupy 32.
  const recipientLimbs = destinationChain.family === 'evm'
    ? evmAddressToAleoHyperlaneRecipient(params.plan.recipient)
    : destinationChain.family === 'solana'
      ? solanaAddressToAleoHyperlaneRecipient(params.plan.recipient)
      : undefined
  const recipient = recipientLimbs
    ? `[${recipientLimbs[0]}u128, ${recipientLimbs[1]}u128]`
    : metadataString(route, 'aleoRecipient')
  // The ABI always carries four allowances. Slot 0 pays the live IGP quote;
  // unused slots retain their reviewed zero-value configuration.
  const allowances = `[${[0, 1, 2, 3].map((index) => allowance(route, index, index === 0 ? gasPayment?.toString() : undefined)).join(', ')}]`
  const usesPlaceholderConfiguration = route.metadata?.aleoPlaceholderConfiguration === true
  // Verification flags record which groups were checked against live Aleo data.
  // Report every unverified field so inspection tools cannot mistake a partial
  // deployment snapshot for an executable transaction.
  let placeholderFields = route.metadata?.aleoAppMetadataVerified === true
    ? PLACEHOLDER_FIELDS.filter((field) => !APP_METADATA_FIELDS.has(field))
    : PLACEHOLDER_FIELDS
  if (route.metadata?.aleoMailboxStateVerified === true) {
    placeholderFields = placeholderFields.filter((field) => !MAILBOX_STATE_FIELDS.has(field))
  }
  if (route.metadata?.aleoRemoteRouterVerified === true) {
    placeholderFields = placeholderFields.filter((field) => !REMOTE_ROUTER_FIELDS.has(field))
  }
  if (route.metadata?.aleoAllowanceSpendersVerified === true) {
    placeholderFields = placeholderFields.filter((field) => !ALLOWANCE_SPENDER_FIELDS.has(field))
  }
  if (route.metadata?.aleoUnusedAllowancesVerified === true) {
    placeholderFields = placeholderFields.filter((field) => !UNUSED_ALLOWANCE_AMOUNT_FIELDS.has(field))
  }
  if (recipientLimbs) {
    placeholderFields = placeholderFields.filter((field) => field !== 'aleoRecipient')
  }
  if (gasPayment != null) {
    placeholderFields = placeholderFields.filter((field) => field !== 'aleoAllowanceAmount0')
  }
  const functionName = params.mode === 'signer' ? 'transfer_remote_as_signer' : 'transfer_remote'

  return {
    routeId: route.id,
    program,
    function: functionName,
    inputs: [
      appMetadata,
      mailboxState,
      remoteRouter,
      `${destination}u32`,
      recipient,
      `${amountAtomic}u128`,
      allowances,
    ],
    amountAtomic,
    usesPlaceholderConfiguration,
    placeholderFields: usesPlaceholderConfiguration
      ? placeholderFields
      : gasPayment == null ? ['aleoAllowanceAmount0'] : [],
  }
}

/**
 * Begins a Hyperlane transfer from Aleo by submitting its source transaction.
 *
 * The wallet proves, signs, and broadcasts the call that commits the source
 * asset. An active reviewed route and current relayer payment are required. A
 * stale payment causes the on-chain call to fail before funds move, but the Aleo
 * transaction fee may still be charged.
 *
 * @param registry Supported assets and reviewed Hyperlane deployments.
 * @param client Aleo wallet that proves, signs, and broadcasts the source transaction.
 * @param params Route, assets, amount, recipient, fee preference, current relayer payment, and recovery callbacks.
 * @returns The Aleo transaction identifier and state needed to follow destination delivery.
 * @throws BridgeError When the route is not ready, the relayer payment is absent, or wallet submission fails.
 */
export async function execute(
  registry: BridgeRegistry,
  client: AleoWalletClient,
  params: ExecuteAleoHyperlaneTransferRemoteParameters,
): Promise<AleoHyperlaneTransferRemoteExecution> {
  const call = buildTransferRemoteCall(registry, params)
  // Submission is the hard safety boundary. Builders remain inspectable for
  // incomplete routes, but a wallet must never receive placeholder inputs.
  if (call.usesPlaceholderConfiguration) {
    throw new BridgeError(`Aleo Hyperlane route contains non-executable placeholder configuration: ${call.routeId}`)
  }
  const route = registry.routes.find((entry) => entry.id === call.routeId)
  if (route?.availability !== 'active') {
    throw new BridgeError(`Aleo Hyperlane route is not active: ${call.routeId}`)
  }
  if (params.gasPaymentMicrocredits == null) {
    throw new BridgeError(`Aleo Hyperlane execution requires a live hook gas payment; call quote first: ${call.routeId}`)
  }
  // `onPrepared` runs after proof construction and before broadcast, allowing
  // the caller to persist the exact immutable transaction for crash recovery.
  const transactionId = await client.executeTransaction({
    program: call.program,
    function: call.function,
    inputs: call.inputs,
    privateFee: params.privateFee ?? false,
    onProgress: async (event) => {
      await params.onProgress?.(event)
      if (event.type === 'transaction-prepared') await params.onPrepared?.(event.transaction)
    },
  })
  if (!transactionId) throw new BridgeError('Aleo wallet returned an empty Hyperlane transaction id')
  const receipt: BridgeReceipt = {
      id: transactionId,
      protocol: 'hyperlane',
      status: 'SOURCE_CONFIRMING',
      sourceTxId: transactionId,
      protocolState: { routeId: call.routeId, sourceProgram: call.program, sourceFunction: call.function },
  }
  // After broadcast, persist only the public transaction identifier needed to
  // observe Aleo acceptance and later destination delivery.
  await params.onSubmitted?.(receipt)
  return {
    transactionId,
    receipt,
  }
}
