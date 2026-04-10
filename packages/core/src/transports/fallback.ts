import { TransportError } from '../errors/errors.js'
import type { Transport } from '../types/transport.js'
import { createTransport } from './createTransport.js'

export function fallback(transports: Transport[]): Transport<'fallback'> {
  return createTransport({
    key: 'fallback',
    name: 'Fallback Transport',
    type: 'fallback',
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
