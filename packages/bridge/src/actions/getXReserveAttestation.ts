import type { BridgeRegistry } from '../types/protocol.js'
import type {
  GetXReserveAttestationParameters,
  XReserveAttestationResult,
  XReserveHttpTransport,
} from '../types/xreserve.js'
import { runGetXReserveAttestation as fetchAttestation } from './internal/evmXReserve.js'

/**
 * Fetches and validates one Circle xReserve attestation.
 *
 * Performs one request and treats HTTP 404 as pending.
 *
 * @param registry Reviewed route snapshot.
 * @param client HTTP client used for the Circle request.
 * @param params Route and message hash to query.
 * @returns Pending or completed attestation state.
 * @throws BridgeError When route metadata or a completed response is invalid.
 * @example const result = await getXReserveAttestation(registry, client, { routeId, messageHash })
 */
export async function getXReserveAttestation(
  registry: BridgeRegistry,
  client: XReserveHttpTransport,
  params: GetXReserveAttestationParameters,
): Promise<XReserveAttestationResult> {
  return fetchAttestation(registry, client, params)
}
