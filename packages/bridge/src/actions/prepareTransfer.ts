import { BridgeError } from '../errors/bridgeErrors.js'
import type {
  BridgeExecutionStep,
  BridgeRegistry,
  BridgeTransferPlan,
  PrepareTransferParameters,
  ProtocolBridgeAsset,
  ProtocolBridgeChain,
  ProtocolBridgeRoute,
} from '../types/protocol.js'
import { parseDecimalAmount } from '../utils/units.js'

function executor(chain: ProtocolBridgeChain): 'aleo-wallet' | 'evm-wallet' | 'solana-wallet' {
  if (chain.family === 'aleo') return 'aleo-wallet'
  if (chain.family === 'evm') return 'evm-wallet'
  return 'solana-wallet'
}

function xreserveSteps(
  route: ProtocolBridgeRoute,
  source: ProtocolBridgeAsset,
  destination: ProtocolBridgeAsset,
  sourceChain: ProtocolBridgeChain,
  destinationChain: ProtocolBridgeChain,
  mintMode: BridgeTransferPlan['mintMode'],
): BridgeExecutionStep[] {
  if (sourceChain.family === 'evm' && destinationChain.family === 'aleo') {
    return [
      { key: 'source-approval', kind: 'approve', chainId: source.chainId, executor: 'evm-wallet', description: `Approve the Circle xReserve contract to spend ${source.symbol}.`, irreversible: false },
      { key: 'source-deposit', kind: 'deposit', chainId: source.chainId, executor: 'evm-wallet', description: `Deposit ${source.symbol} into Circle xReserve for Aleo.`, irreversible: true },
      { key: 'deposit-attestation', kind: 'wait-attestation', executor: 'protocol', description: 'Wait for Circle to attest the confirmed reserve deposit.', irreversible: false },
      { key: 'destination-mint', kind: 'mint', chainId: destination.chainId, executor: 'aleo-wallet', description: mintMode === 'private' ? `Mint attested ${destination.symbol} through the shielded wrapper.` : `Mint attested ${destination.symbol} as an Aleo ${mintMode === 'record' ? 'record' : 'public balance'}.`, irreversible: false },
    ]
  }
  if (sourceChain.family === 'aleo' && destinationChain.family === 'evm') {
    return [
      { key: 'source-burn', kind: 'burn', chainId: source.chainId, executor: 'aleo-wallet', description: `Burn ${source.symbol} and create the xReserve withdrawal intent.`, irreversible: true },
      { key: 'withdrawal-attestation', kind: 'wait-attestation', executor: 'protocol', description: 'Wait for the Aleo burn signature and Circle withdrawal attestation.', irreversible: false },
      { key: 'destination-withdrawal', kind: 'withdraw', chainId: destination.chainId, executor: 'protocol', description: `Release ${destination.symbol} from the Circle reserve.`, irreversible: false },
      { key: 'destination-confirmation', kind: 'confirm-delivery', chainId: destination.chainId, executor: 'protocol', description: 'Confirm the destination USDC balance change.', irreversible: false },
    ]
  }
  throw new BridgeError(`Unsupported xReserve route shape: ${route.id}`)
}

function hyperlaneSteps(
  source: ProtocolBridgeAsset,
  destination: ProtocolBridgeAsset,
  sourceChain: ProtocolBridgeChain,
  destinationChain: ProtocolBridgeChain,
): BridgeExecutionStep[] {
  const steps: BridgeExecutionStep[] = []
  if (source.kind === 'token' && sourceChain.family !== 'aleo') {
    steps.push({
      key: 'source-approval',
      kind: 'approve',
      chainId: source.chainId,
      executor: executor(sourceChain),
      description: `Approve the Hyperlane Warp Route to spend ${source.symbol}.`,
      irreversible: false,
    })
  }
  steps.push(
    { key: 'source-dispatch', kind: 'dispatch', chainId: source.chainId, executor: executor(sourceChain), description: `Dispatch ${source.symbol} through its Hyperlane Warp Route.`, irreversible: true },
    { key: 'message-delivery', kind: 'wait-delivery', executor: 'protocol', description: 'Wait for the Hyperlane message to be relayed and processed.', irreversible: false },
    { key: 'destination-confirmation', kind: 'confirm-delivery', chainId: destination.chainId, executor: executor(destinationChain), description: `Confirm delivery of ${destination.symbol} on the destination chain.`, irreversible: false },
  )
  return steps
}

/**
 * Prepares the ordered operations for a protocol bridge transfer.
 *
 * Pure and local: validates the route, amount, and recipient, then returns a
 * serializable plan. It does not query fees, sign, submit, or move funds.
 * Routes marked `metadata-required` can be planned but cannot be executed until
 * a later protocol adapter validates their deployment metadata.
 *
 * @param registry Reviewed registry snapshot.
 * @param params Route, decimal amount, recipient, and optional sender/privacy mode.
 * @returns A resumable transfer plan with the irreversible step identified.
 * @throws BridgeError When the route is missing or disabled, the amount is zero
 *   or malformed, its precision exceeds either asset, or the recipient fails validation.
 *
 * @example
 * const plan = prepareTransfer(registry, {
 *   routeId: 'xreserve:ethereum/usdc->aleo/usdcx',
 *   amount: '25',
 *   recipient: 'aleo1...',
 * })
 */
export function prepareTransfer(
  registry: BridgeRegistry,
  params: PrepareTransferParameters,
): BridgeTransferPlan {
  const route = registry.routes.find((entry) => entry.id === params.routeId)
  if (!route) throw new BridgeError(`Unknown bridge route: ${params.routeId}`)
  if (route.availability === 'disabled') throw new BridgeError(`Bridge route is disabled: ${params.routeId}`)

  const sourceAsset = registry.assets.find((asset) => asset.id === route.sourceAssetId)!
  const destinationAsset = registry.assets.find((asset) => asset.id === route.destinationAssetId)!
  const sourceChain = registry.chains.find((chain) => chain.id === sourceAsset.chainId)!
  const destinationChain = registry.chains.find((chain) => chain.id === destinationAsset.chainId)!

  if (params.privateRecipient === true && params.mintMode != null && params.mintMode !== 'private') {
    throw new BridgeError('privateRecipient conflicts with the selected mintMode')
  }
  const mintMode = params.mintMode ?? (params.privateRecipient === true ? 'private' : 'public')

  if ((params.mintMode != null || params.privateRecipient === true) && destinationChain.family !== 'aleo') {
    throw new BridgeError('Aleo mint mode is only valid when the destination chain is Aleo')
  }
  if (route.protocol !== 'xreserve' && mintMode !== 'public') {
    throw new BridgeError('record and private mint modes are only supported by xReserve routes')
  }

  const atomic = parseDecimalAmount(params.amount, sourceAsset.decimals)
  if (atomic <= 0n) throw new BridgeError('Bridge transfer amount must be greater than zero')
  parseDecimalAmount(params.amount, destinationAsset.decimals)

  if (destinationAsset.addressValidationRegex) {
    const regex = new RegExp(destinationAsset.addressValidationRegex)
    if (!regex.test(params.recipient)) {
      throw new BridgeError(`Recipient does not match ${destinationAsset.chainId} address format`)
    }
  }

  const steps = route.protocol === 'xreserve'
    ? xreserveSteps(route, sourceAsset, destinationAsset, sourceChain, destinationChain, mintMode)
    : hyperlaneSteps(sourceAsset, destinationAsset, sourceChain, destinationChain)
  const fees: BridgeTransferPlan['fees'] = []

  return {
    registryVersion: registry.version,
    protocol: route.protocol,
    route,
    sourceAsset,
    destinationAsset,
    amountIn: params.amount,
    // Both current protocols preserve display units before live fee deduction.
    // Omit a promise about net output until fee quoting is implemented.
    recipient: params.recipient,
    ...(params.sender == null ? {} : { sender: params.sender }),
    mintMode,
    privateRecipient: mintMode === 'private',
    quote: {
      routeId: route.id,
      protocol: route.protocol,
      amountIn: params.amount,
      fees,
      status: 'not-queried',
    },
    fees,
    steps,
  }
}
