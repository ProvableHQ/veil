import type { BridgeRegistry } from '../types/protocol.js'
import type {
  AleoHyperlaneTransferRemoteExecution,
  AleoWalletClient,
  ExecuteAleoHyperlaneTransferRemoteParameters,
} from '../types/aleo.js'
import { runExecuteAleoHyperlaneTransferRemote as executeTransfer } from './internal/aleoHyperlane.js'

/**
 * Executes an Aleo-origin Hyperlane `transfer_remote` call.
 *
 * Prompts or uses the supplied signer, proves, and broadcasts the transaction.
 *
 * @param registry Reviewed route snapshot.
 * @param client Aleo wallet client used for execution.
 * @param params Prepared transfer, live gas payment, and fee settings.
 * @returns Transaction identifier and resumable Hyperlane state.
 * @throws BridgeError When route configuration, payment, or submission is invalid.
 * @example const execution = await executeAleoHyperlaneTransferRemote(registry, client, { plan, gasPaymentMicrocredits })
 */
export async function executeAleoHyperlaneTransferRemote(
  registry: BridgeRegistry,
  client: AleoWalletClient,
  params: ExecuteAleoHyperlaneTransferRemoteParameters,
): Promise<AleoHyperlaneTransferRemoteExecution> {
  return executeTransfer(registry, client, params)
}
