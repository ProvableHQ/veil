import type { Transport, TransportConfig } from '../types/transport.js'

/**
 * Wraps a transport config into a {@link Transport} instance.
 *
 * The low-level building block the concrete transports ({@link http},
 * {@link custom}, {@link fallback}) are built on; call it directly only
 * when defining a custom transport shape. Pure and local — it lifts `config`
 * and exposes `config.request` as the transport's `request`.
 *
 * @param config Transport config carrying `key`, `name`, `type`, `request`,
 *   and optional network and retry fields.
 * @returns A transport pairing the config with its request function.
 *
 * @example
 * import { createTransport } from '@veil/core'
 *
 * const transport = createTransport({
 *   key: 'custom',
 *   name: 'Custom Transport',
 *   type: 'custom',
 *   request: async ({ method, params }) => provider.request({ method, params }),
 * })
 */
export function createTransport<type extends string>(
  config: TransportConfig<type>,
): Transport<type> {
  return {
    config,
    request: config.request,
  }
}
