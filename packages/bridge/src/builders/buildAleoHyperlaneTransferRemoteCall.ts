import type { BridgeRegistry } from '../types/protocol.js'
import type { AleoHyperlaneTransferRemoteCall, ExecuteAleoHyperlaneTransferRemoteParameters } from '../types/aleo.js'
import { buildTransferRemoteCall as buildTransferCall } from '../protocols/hyperlane/aleo.js'

/**
 * Builds an Aleo Hyperlane `transfer_remote` call without prompting a wallet.
 *
 * Pure and local. Validates the prepared plan against reviewed route metadata.
 *
 * @param registry Reviewed route snapshot.
 * @param params Prepared Aleo-origin transfer and fee settings.
 * @returns Program, function, and ordered Aleo inputs.
 * @throws BridgeError When the plan or route metadata is invalid.
 * @example const call = buildAleoHyperlaneTransferRemoteCall(registry, { plan, gasPaymentMicrocredits })
 */
export function buildAleoHyperlaneTransferRemoteCall(
  registry: BridgeRegistry,
  params: ExecuteAleoHyperlaneTransferRemoteParameters,
): AleoHyperlaneTransferRemoteCall {
  return buildTransferCall(registry, params)
}
