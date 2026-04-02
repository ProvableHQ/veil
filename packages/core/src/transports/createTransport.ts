import type { Transport, TransportConfig } from '../types/transport.js'

export function createTransport<type extends string>(
  config: TransportConfig<type>,
): Transport<type> {
  return {
    config,
    request: config.request,
  }
}
