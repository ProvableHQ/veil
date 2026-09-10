import type { BridgeRegistry } from '../types/protocol.js'
import type { ExecuteXReserveBurnParameters, XReserveBurnCall } from '../types/aleo.js'
import { buildBurnCall } from '../protocols/xreserve/aleoToEvm.js'

/**
 * Builds an Aleo xReserve burn call without prompting a wallet.
 *
 * Pure and local. Selects the reviewed entrypoint and validates mode-specific inputs.
 *
 * @param registry Reviewed route snapshot.
 * @param params Prepared reverse route and burn inputs.
 * @returns Program, function, ordered inputs, and native recipient metadata.
 * @throws BridgeError When the route or burn inputs are invalid.
 * @example const call = buildXReserveBurnCall(registry, { plan, mode: 'public' })
 */
export function buildXReserveBurnCall(
  registry: BridgeRegistry,
  params: ExecuteXReserveBurnParameters,
): XReserveBurnCall {
  return buildBurnCall(registry, params)
}
