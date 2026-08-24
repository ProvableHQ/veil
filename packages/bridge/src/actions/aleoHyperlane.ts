import { BridgeError } from '../errors/bridgeErrors.js'
import type {
  AleoBridgeExecutor,
  AleoHyperlaneTransferRemoteCall,
  AleoHyperlaneTransferRemoteExecution,
  ExecuteAleoHyperlaneTransferRemoteParameters,
} from '../types/aleo.js'
import type { BridgeRegistry, ProtocolBridgeRoute } from '../types/protocol.js'
import {
  evmAddressToAleoHyperlaneRecipient,
  solanaAddressToAleoHyperlaneRecipient,
} from '../utils/hyperlane.js'
import { parseDecimalAmount } from '../utils/units.js'

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

function allowance(route: ProtocolBridgeRoute, index: number): string {
  return `{ spender: ${metadataString(route, `aleoAllowanceSpender${index}`)}, amount: ${metadataString(route, `aleoAllowanceAmount${index}`)}u64 }`
}

/**
 * Builds an Aleo Hyperlane `transfer_remote` call without prompting a wallet.
 *
 * The default registry deliberately produces non-executable calls containing
 * conspicuous placeholder deployment values. This makes the complete seven-input
 * ABI inspectable while preventing those values from being mistaken for live data.
 *
 * @param registry Reviewed route snapshot supplying the Aleo Warp Route configuration.
 * @param params Prepared Aleo-origin Hyperlane plan.
 * @returns Exact program, transition, and ordered Aleo inputs.
 * @throws BridgeError When the plan or route metadata is inconsistent.
 *
 * @example
 * const call = buildAleoHyperlaneTransferRemoteCall(registry, { plan })
 */
export function buildAleoHyperlaneTransferRemoteCall(
  registry: BridgeRegistry,
  params: ExecuteAleoHyperlaneTransferRemoteParameters,
): AleoHyperlaneTransferRemoteCall {
  if (params.mode != null && params.mode !== 'caller' && params.mode !== 'signer') {
    throw new BridgeError(`Unsupported Aleo Hyperlane transfer mode: ${String(params.mode)}`)
  }
  const { route, program, destinationChain } = validatedRoute(registry, params)
  const amountAtomic = parseDecimalAmount(params.plan.amountIn, params.plan.sourceAsset.decimals)
  const destination = metadataNumber(route, 'aleoDestinationDomain')
  const localDecimals = optionalMetadataNumber(route, 'aleoLocalDecimals', params.plan.sourceAsset.decimals)
  const remoteDecimals = optionalMetadataNumber(route, 'aleoRemoteDecimals', params.plan.destinationAsset.decimals)
  const appMetadata = `{ token_type: ${metadataString(route, 'aleoTokenType')}u8, token_owner: ${metadataString(route, 'aleoTokenOwner')}, ism: ${metadataString(route, 'aleoIsm')}, hook: ${metadataString(route, 'aleoHook')}, token_id: ${metadataString(route, 'aleoTokenId')}, local_decimals: ${localDecimals}u8, remote_decimals: ${remoteDecimals}u8 }`
  const mailboxState = `{ default_hook: ${metadataString(route, 'aleoMailboxDefaultHook')}, required_hook: ${metadataString(route, 'aleoMailboxRequiredHook')} }`
  const remoteRouter = `{ domain: ${destination}u32, recipient: ${metadataString(route, 'aleoRemoteRouterRecipient')}, gas: ${metadataString(route, 'aleoRemoteRouterGas')}u128 }`
  const recipientLimbs = destinationChain.family === 'evm'
    ? evmAddressToAleoHyperlaneRecipient(params.plan.recipient)
    : destinationChain.family === 'solana'
      ? solanaAddressToAleoHyperlaneRecipient(params.plan.recipient)
      : undefined
  const recipient = recipientLimbs
    ? `[${recipientLimbs[0]}u128, ${recipientLimbs[1]}u128]`
    : metadataString(route, 'aleoRecipient')
  const allowances = `[${[0, 1, 2, 3].map((index) => allowance(route, index)).join(', ')}]`
  const usesPlaceholderConfiguration = route.metadata?.aleoPlaceholderConfiguration === true
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
    placeholderFields: usesPlaceholderConfiguration ? placeholderFields : [],
  }
}

/**
 * Submits a fully configured Aleo Hyperlane `transfer_remote` transaction.
 *
 * Default-registry calls fail before wallet access because their deployment
 * values are placeholders. Submission becomes available only after a reviewed
 * registry removes the placeholder flag and supplies every required value.
 *
 * @param registry Reviewed route snapshot supplying the Aleo Warp Route configuration.
 * @param executor Connected Aleo wallet client that proves, signs, and broadcasts.
 * @param params Prepared Aleo-origin Hyperlane plan and fee preference.
 * @returns The Aleo transaction id and resumable Hyperlane receipt.
 * @throws BridgeError When configuration is placeholder, invalid, or the wallet returns no id.
 */
export async function executeAleoHyperlaneTransferRemote(
  registry: BridgeRegistry,
  executor: AleoBridgeExecutor,
  params: ExecuteAleoHyperlaneTransferRemoteParameters,
): Promise<AleoHyperlaneTransferRemoteExecution> {
  const call = buildAleoHyperlaneTransferRemoteCall(registry, params)
  if (call.usesPlaceholderConfiguration) {
    throw new BridgeError(`Aleo Hyperlane route contains non-executable placeholder configuration: ${call.routeId}`)
  }
  const route = registry.routes.find((entry) => entry.id === call.routeId)
  if (route?.availability !== 'active') {
    throw new BridgeError(`Aleo Hyperlane route is not active: ${call.routeId}`)
  }
  const result = await executor.executeTransaction({
    program: call.program,
    function: call.function,
    inputs: call.inputs,
    privateFee: params.privateFee ?? false,
  })
  const transactionId = typeof result === 'string' ? result : result.transactionId
  if (!transactionId) throw new BridgeError('Aleo wallet returned an empty Hyperlane transaction id')
  return {
    transactionId,
    receipt: {
      id: transactionId,
      protocol: 'hyperlane',
      status: 'SOURCE_CONFIRMING',
      sourceTxId: transactionId,
      protocolState: { routeId: call.routeId, sourceProgram: call.program, sourceFunction: call.function },
    },
  }
}
