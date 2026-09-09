import type { EvmClient, EvmWalletClient } from '../connections/evm.js'
import type { BridgeRegistry } from '../types/protocol.js'
import type { ExecuteEvmXReserveTransferParameters, EvmXReserveTransferExecution } from '../types/xreserve.js'
import { runExecuteEvmXReserveTransfer as executeTransfer } from './internal/evmXReserve.js'

/**
 * Executes an Ethereum-to-Aleo Circle xReserve deposit.
 *
 * Approves USDC when required, submits the deposit, and returns resumable state.
 *
 * @param registry Reviewed deployment snapshot.
 * @param client EVM client with wallet authorization.
 * @param params Prepared transfer, resume state, and polling controls.
 * @returns Approval identifiers and resumable xReserve progress.
 * @throws BridgeError When validation, submission, confirmation, or event verification fails.
 * @example const execution = await executeEvmXReserveTransfer(registry, client, { plan })
 */
export async function executeEvmXReserveTransfer(
  registry: BridgeRegistry,
  client: EvmClient & { walletClient: EvmWalletClient },
  params: ExecuteEvmXReserveTransferParameters,
): Promise<EvmXReserveTransferExecution> {
  return executeTransfer(registry, client, params)
}
