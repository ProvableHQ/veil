import { BridgeEnvelopeError } from '../errors/bridgeErrors.js'
import type { ApiEnvelope } from '../types/envelope.js'

export function unwrapEnvelope<T>(
  response: ApiEnvelope<T> | null | undefined,
  options: { keepMeta: false },
): T
export function unwrapEnvelope<T>(
  response: ApiEnvelope<T> | null | undefined,
  options: { keepMeta: true },
): { data: T; meta: Record<string, unknown> }
export function unwrapEnvelope<T>(
  response: ApiEnvelope<T> | null | undefined,
  options: { keepMeta: boolean },
): T | { data: T; meta: Record<string, unknown> } {
  if (response == null || typeof response !== 'object' || !('data' in response)) {
    throw new BridgeEnvelopeError('Bridge response missing "data" envelope')
  }
  if (options.keepMeta) {
    return { data: response.data, meta: response.meta ?? {} }
  }
  return response.data
}
