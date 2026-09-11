import type { BridgeRegistry } from '../types/protocol.js'
import type { AleoHyperlaneTransferRemoteCall, ExecuteAleoHyperlaneTransferRemoteParameters } from '../types/aleo.js'
import { buildTransferRemoteCall as buildTransferCall } from '../protocols/hyperlane/aleo.js'

/**
 * Builds an Aleo Hyperlane `transfer_remote` call without prompting a wallet.
 *
 * Validates the transfer details against reviewed route metadata without
 * contacting Aleo or prompting a wallet.
 *
 * @param registry Supported assets and reviewed Hyperlane deployments.
 * @param params Route, amount, recipient, authorization mode, and optional current relayer payment.
 * @returns Aleo program, transition, ordered inputs, atomic amount, and any configuration that is not ready for submission.
 * @throws BridgeError When the transfer conflicts with the deployment or the relayer payment is invalid.
 * @example const call = buildAleoHyperlaneTransferRemoteCall(registry, { plan, gasPaymentMicrocredits })
 */
export function buildAleoHyperlaneTransferRemoteCall(
  registry: BridgeRegistry,
  params: ExecuteAleoHyperlaneTransferRemoteParameters,
): AleoHyperlaneTransferRemoteCall {
  return buildTransferCall(registry, params)
}
