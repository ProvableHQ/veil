import { BridgeError } from '../errors/bridgeErrors.js'
import type {
  BridgeExecutionStep,
  BridgeRegistry,
  BridgePlan,
  PrepareParameters,
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
  mintMode: BridgePlan['mintMode'],
): BridgeExecutionStep[] {
  if (sourceChain.family === 'evm' && destinationChain.family === 'aleo') {
    return [
      { key: 'source-approval', kind: 'approve', chainId: source.chainId, executor: 'evm-wallet', description: `Approve the Circle xReserve contract to spend ${source.symbol}.`, irreversible: false },
      { key: 'source-deposit', kind: 'deposit', chainId: source.chainId, executor: 'evm-wallet', description: `Deposit ${source.symbol} into Circle xReserve for Aleo.`, irreversible: true },
      { key: 'deposit-attestation', kind: 'wait-attestation', executor: 'protocol', description: 'Wait for Circle to attest the confirmed reserve deposit.', irreversible: false },
      { key: 'destination-mint', kind: 'mint', chainId: destination.chainId, executor: mintMode === 'private' ? 'aleo-wallet' : 'protocol', description: mintMode === 'private' ? `Submit private_mint to mint attested ${destination.symbol} through the shielded wrapper.` : `Wait for attested ${destination.symbol} to mint as an Aleo ${mintMode === 'record' ? 'record' : 'public balance'}.`, irreversible: false },
    ]
  }
  if (sourceChain.family === 'aleo' && destinationChain.family === 'evm') {
    return [
      { key: 'source-burn', kind: 'burn', chainId: source.chainId, executor: 'aleo-wallet', description: `Burn ${source.symbol} and create the xReserve withdrawal intent; private burn is the default.`, irreversible: true },
      { key: 'withdrawal-attestation', kind: 'wait-attestation', executor: 'protocol', description: 'Wait for the Aleo burn attestation service to forward the accepted burn to Circle.', irreversible: false },
      { key: 'destination-withdrawal', kind: 'withdraw', chainId: destination.chainId, executor: 'protocol', description: `Wait for Circle to release ${destination.symbol} to the native recipient.`, irreversible: false },
      { key: 'destination-confirmation', kind: 'confirm-delivery', chainId: destination.chainId, executor: 'protocol', description: 'Confirm the destination USDC balance change.', irreversible: false },
    ]
  }
  throw new BridgeError(`Unsupported xReserve route direction: ${route.id}`)
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
    { key: 'destination-confirmation', kind: 'confirm-delivery', chainId: destination.chainId, executor: 'protocol', description: `Confirm relayer delivery of ${destination.symbol} on the destination chain.`, irreversible: false },
  )
  return steps
}

/**
 * Describes how an amount of an asset can move between two chains.
 *
 * The caller chooses the source asset, destination asset, amount, recipient,
 * and optionally the bridge provider. The result identifies the supported
 * route, the assets that will be debited and delivered, and each stage required
 * to complete the transfer.
 *
 * No blockchain or bridge provider is contacted, no wallet approval is
 * requested, and no funds move. The returned information can be priced before
 * the caller decides whether to begin the transfer.
 *
 * @param registry Supported chains, assets, and bridge provider deployments.
 * @param params Desired source asset, destination asset, amount, recipient, provider, sender, and Aleo privacy preference.
 * @returns The route, assets, amount, recipient, and stages required for the cross-chain transfer.
 * @throws BridgeError When no available provider supports the requested transfer, the amount cannot be represented by both assets, or the recipient is invalid for the destination chain.
 *
 * @example
 * const plan = prepare(registry, {
 *   source: { chain: 'ethereum', asset: 'usdc' },
 *   destination: { chain: 'aleo', asset: 'usdcx' },
 *   amount: '25',
 *   recipient: 'aleo1...',
 * })
 */
export function prepare(
  registry: BridgeRegistry,
  params: PrepareParameters,
): BridgePlan {
  // Resolve both chain-specific asset representations before route selection.
  // The same symbol can refer to different contracts or programs on each chain.
  const sourceAsset = registry.assets.find((asset) => asset.chainId === params.source.chain && asset.key === params.source.asset)
  if (!sourceAsset) throw new BridgeError(`Unknown source asset ${params.source.asset} on ${params.source.chain}`)
  const destinationAsset = registry.assets.find((asset) => asset.chainId === params.destination.chain && asset.key === params.destination.asset)
  if (!destinationAsset) throw new BridgeError(`Unknown destination asset ${params.destination.asset} on ${params.destination.chain}`)
  const routes = registry.routes.filter((entry) => entry.sourceAssetId === sourceAsset.id
    && entry.destinationAssetId === destinationAsset.id
    && entry.availability !== 'disabled'
    && (params.bridgeProtocol == null || entry.protocol === params.bridgeProtocol))
  if (routes.length === 0) {
    throw new BridgeError(`No bridge route from ${params.source.chain}/${params.source.asset} to ${params.destination.chain}/${params.destination.asset}`)
  }
  if (routes.length > 1) {
    throw new BridgeError(`Multiple bridge routes match ${params.source.chain}/${params.source.asset} to ${params.destination.chain}/${params.destination.asset}; specify bridgeProtocol`)
  }
  const route = routes[0]!

  const sourceChain = registry.chains.find((chain) => chain.id === sourceAsset.chainId)!
  const destinationChain = registry.chains.find((chain) => chain.id === destinationAsset.chainId)!

  if (params.privateRecipient === true && params.mintMode != null && params.mintMode !== 'private') {
    throw new BridgeError('privateRecipient conflicts with the selected mintMode')
  }
  // xReserve delivery on Aleo can be a public balance, a private record minted
  // by the provider, or a private wrapper mint authorized by the recipient.
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

  // Steps are descriptive application guidance. They do not execute and are
  // derived from the validated direction and provider rather than caller input.
  const steps = route.protocol === 'xreserve'
    ? xreserveSteps(route, sourceAsset, destinationAsset, sourceChain, destinationChain, mintMode)
    : hyperlaneSteps(sourceAsset, destinationAsset, sourceChain, destinationChain)
  const fees: BridgePlan['fees'] = []

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
    fees,
    steps,
  }
}
