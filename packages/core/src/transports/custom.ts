import type { RequestFn, Transport } from '../types/transport.js'
import { createTransport } from './createTransport.js'

type CustomTransportConfig = {
  request: RequestFn
  key?: string | undefined
  name?: string | undefined
}

/**
 * Creates a transport backed by a caller-supplied request function.
 *
 * Use for routing requests through an existing provider — an injected
 * wallet, a proxy, or a test double — instead of Veil's built-in HTTP path.
 * Building the transport is pure; the supplied `request` function is what
 * performs I/O when the transport is called.
 *
 * @param config Holds the `request` function plus an optional `key` (defaults
 *   to `'custom'`) and `name` (defaults to `'Custom Transport'`) that identify
 *   the transport.
 * @returns A transport of type `'custom'` that forwards every call to
 *   `config.request`.
 *
 * @example
 * import { custom } from '@provablehq/veil-core'
 *
 * const transport = custom({
 *   request: async ({ method, params }) => window.aleo.request({ method, params }),
 * })
 */
export function custom(config: CustomTransportConfig): Transport<'custom'> {
  const { request, key = 'custom', name = 'Custom Transport' } = config
  return createTransport({ key, name, type: 'custom', request })
}
