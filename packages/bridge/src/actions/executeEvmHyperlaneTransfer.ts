import type { EvmClient, EvmWalletClient } from '../connections/evm.js'
import type { BridgeRegistry } from '../types/protocol.js'
import type { ExecuteEvmHyperlaneTransferParameters, EvmHyperlaneTransferExecution } from '../types/evm.js'
import { runExecuteEvmHyperlaneTransfer as executeTransfer } from './internal/evmHyperlane.js'

/**
 * Executes an Ethereum-origin Hyperlane Warp Route transfer.
 *
 * May approve collateral, prompts or uses the configured signer, and broadcasts transactions.
 *
 * @param registry Reviewed deployment snapshot.
 * @param client EVM client with wallet authorization.
 * @param params Prepared transfer, encoded recipient, and polling controls.
 * @returns Submitted transaction identifiers and resumable transfer state.
 * @throws BridgeError When validation, submission, or confirmed execution fails.
 * @example const execution = await executeEvmHyperlaneTransfer(registry, client, { plan, recipientBytes32 })
 */
export async function executeEvmHyperlaneTransfer(
  registry: BridgeRegistry,
  client: EvmClient & { walletClient: EvmWalletClient },
  params: ExecuteEvmHyperlaneTransferParameters,
): Promise<EvmHyperlaneTransferExecution> {
  return executeTransfer(registry, client, params)
}
