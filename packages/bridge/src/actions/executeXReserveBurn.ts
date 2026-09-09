import type { BridgeRegistry } from '../types/protocol.js'
import type { AleoWalletClient, ExecuteXReserveBurnParameters, XReserveBurnExecution } from '../types/aleo.js'
import { runExecuteXReserveBurn as executeBurn } from './internal/xreserveBurn.js'

/**
 * Executes an Aleo xReserve burn.
 *
 * Prompts or uses the supplied signer, proves, and broadcasts the transaction.
 *
 * @param registry Reviewed route snapshot.
 * @param client Aleo wallet client used for execution.
 * @param params Prepared reverse route, burn inputs, and fee settings.
 * @returns Transaction identifier and resumable source state.
 * @throws BridgeError When call construction or submission fails.
 * @example const execution = await executeXReserveBurn(registry, client, { plan, mode: 'public' })
 */
export async function executeXReserveBurn(
  registry: BridgeRegistry,
  client: AleoWalletClient,
  params: ExecuteXReserveBurnParameters,
): Promise<XReserveBurnExecution> {
  return executeBurn(registry, client, params)
}
