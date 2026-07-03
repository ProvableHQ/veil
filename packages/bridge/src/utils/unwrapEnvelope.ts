import { BridgeEnvelopeError } from '../errors/bridgeErrors.js'

/**
 * Unwraps the bridge API's `{ data, meta? }` response envelope.
 *
 * Every bridge endpoint wraps its payload this way; actions call this on the
 * raw transport response to get the payload out (or, with `keepMeta: true`,
 * the payload alongside the meta block — quotes carry `quoteRequestId` and
 * provider warnings there). Pure and local.
 *
 * @param response The raw transport response.
 * @param options Pass `{ keepMeta: true }` to also get the meta block
 *   (defaulted to `{}` when the API omits it). Defaults to data-only.
 * @returns The envelope's `data`, or `{ data, meta }` when meta is kept.
 * @throws BridgeEnvelopeError When the response has no `data` key — a
 *   malformed or non-envelope response.
 *
 * @example
 * const flags = unwrapEnvelope<BridgeFlagsDto>(await client.request({ method: 'getBridgeFlags' }))
 */
export function unwrapEnvelope<T>(response: unknown, options?: { keepMeta: false }): T
export function unwrapEnvelope<T>(
  response: unknown,
  options: { keepMeta: true },
): { data: T; meta: Record<string, unknown> }
export function unwrapEnvelope<T>(
  response: unknown,
  options?: { keepMeta: boolean },
): T | { data: T; meta: Record<string, unknown> } {
  if (response == null || typeof response !== 'object' || !('data' in response)) {
    throw new BridgeEnvelopeError('Bridge response missing "data" envelope')
  }
  const envelope = response as { data: T; meta?: Record<string, unknown> }
  if (options?.keepMeta) {
    return { data: envelope.data, meta: envelope.meta ?? {} }
  }
  return envelope.data
}
