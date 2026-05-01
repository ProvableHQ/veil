import { TransportError } from '../errors/errors.js'
import type { Transport } from '../types/transport.js'
import { createTransport } from './createTransport.js'

export function fallback(transports: Transport[]): Transport<'fallback'> {
  // Inherit network from the first transport that declares one — typical
  // pairing is [walletAdapter, http(url, { network })] where the wallet
  // adapter's transport doesn't carry a network, but http does.
  const network = transports.find((t) => t.config.network != null)?.config.network ?? null

  return createTransport({
    key: 'fallback',
    name: 'Fallback Transport',
    type: 'fallback',
    network,
    request: async (args) => {
      const errors: Error[] = []
      for (const transport of transports) {
        try {
          return await transport.request(args)
        } catch (error) {
          errors.push(error as Error)
        }
      }
      // Surface the first error message (usually the wallet transport's real error)
      const firstError = errors[0]
      const message = firstError?.message
        ? `${firstError.message} (all ${errors.length} transports failed)`
        : 'All transports failed.'
      throw new TransportError(message, { cause: firstError })
    },
  })
}
