import type { BridgeRegistry } from '../types/protocol.js'
import type { ExecuteXReserveBurnParameters, XReserveBurnCall } from '../types/aleo.js'
import { buildBurnCall } from '../protocols/xreserve/aleoToEvm.js'

/**
 * Builds an Aleo xReserve burn call without prompting a wallet.
 *
 * Selects the reviewed entrypoint and validates mode-specific inputs without
 * contacting Aleo or prompting a wallet.
 *
 * @param registry Supported assets and reviewed xReserve deployments.
 * @param params Route, amount, Ethereum recipient, funding mode, and private inputs when applicable.
 * @returns Aleo program, transition, ordered inputs, atomic amount, destination domain, and encoded recipient.
 * @throws BridgeError When the route is unavailable, the amount cannot cover the withdrawal fee, the recipient is invalid, or private funding inputs are missing.
 * @example const call = buildXReserveBurnCall(registry, { plan, mode: 'public' })
 */
export function buildXReserveBurnCall(
  registry: BridgeRegistry,
  params: ExecuteXReserveBurnParameters,
): XReserveBurnCall {
  return buildBurnCall(registry, params)
}
