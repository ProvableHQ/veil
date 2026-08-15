import { BridgeError } from '../errors/bridgeErrors.js'
import type {
  AleoBridgeExecutor,
  AleoHyperlaneTransferRemoteCall,
  AleoHyperlaneTransferRemoteExecution,
  ExecuteAleoHyperlaneTransferRemoteParameters,
} from '../types/aleo.js'
import type { BridgeRegistry, ProtocolBridgeRoute } from '../types/protocol.js'
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

function validatedRoute(registry: BridgeRegistry, params: ExecuteAleoHyperlaneTransferRemoteParameters) {
  const { plan } = params
  if (plan.protocol !== 'hyperlane' || plan.route.protocol !== 'hyperlane') throw new BridgeError('Aleo transfer_remote requires a Hyperlane transfer plan')
  if (plan.registryVersion !== registry.version) throw new BridgeError(`Transfer plan uses registry ${plan.registryVersion}; expected ${registry.version}`)
  const route = registry.routes.find((entry) => entry.id === plan.route.id)
  if (!route || route.protocol !== 'hyperlane') throw new BridgeError(`Hyperlane route is not configured: ${plan.route.id}`)
  if (route.sourceAssetId !== plan.sourceAsset.id || route.destinationAssetId !== plan.destinationAsset.id) throw new BridgeError(`Transfer plan assets do not match configured route: ${route.id}`)
  const sourceChain = registry.chains.find((chain) => chain.id === plan.sourceAsset.chainId)
  if (sourceChain?.family !== 'aleo') throw new BridgeError('transfer_remote requires an Aleo source asset')
  const program = metadataString(route, 'aleoRouterProgram')
  if (!program.endsWith('.aleo')) throw new BridgeError(`Aleo Warp Route program is invalid: ${route.id}`)
  return { route, program }
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
  const { route, program } = validatedRoute(registry, params)
  const amountAtomic = parseDecimalAmount(params.plan.amountIn, params.plan.sourceAsset.decimals)
  const destination = metadataNumber(route, 'aleoDestinationDomain')
  const appMetadata = `{ token_type: ${metadataString(route, 'aleoTokenType')}u8, token_owner: ${metadataString(route, 'aleoTokenOwner')}, ism: ${metadataString(route, 'aleoIsm')}, hook: ${metadataString(route, 'aleoHook')}, token_id: ${metadataString(route, 'aleoTokenId')}, local_decimals: ${params.plan.sourceAsset.decimals}u8, remote_decimals: ${params.plan.destinationAsset.decimals}u8 }`
  const mailboxState = `{ default_hook: ${metadataString(route, 'aleoMailboxDefaultHook')}, required_hook: ${metadataString(route, 'aleoMailboxRequiredHook')} }`
  const remoteRouter = `{ domain: ${destination}u32, recipient: ${metadataString(route, 'aleoRemoteRouterRecipient')}, gas: ${metadataString(route, 'aleoRemoteRouterGas')}u128 }`
  const allowances = `[${[0, 1, 2, 3].map((index) => allowance(route, index)).join(', ')}]`
  const usesPlaceholderConfiguration = route.metadata?.aleoPlaceholderConfiguration === true

  return {
    routeId: route.id,
    program,
    function: 'transfer_remote',
    inputs: [
      appMetadata,
      mailboxState,
      remoteRouter,
      `${destination}u32`,
      metadataString(route, 'aleoRecipient'),
      `${amountAtomic}u128`,
      allowances,
    ],
    amountAtomic,
    usesPlaceholderConfiguration,
    placeholderFields: usesPlaceholderConfiguration ? PLACEHOLDER_FIELDS : [],
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
