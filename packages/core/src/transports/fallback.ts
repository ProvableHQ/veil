import { TransportError } from '../errors/errors.js'
import type { Transport } from '../types/transport.js'
import { createTransport } from './createTransport.js'

export function fallback(transports: Transport[]): Transport<'fallback'> {
  return createTransport({
    key: 'fallback',
    name: 'Fallback Transport',
    type: 'fallback',
    request: async (args) => {
      let lastError: Error | undefined
      for (const transport of transports) {
        try {
          return await transport.request(args)
        } catch (error) {
          lastError = error as Error
        }
      }
      throw new TransportError('All transports failed.', { cause: lastError })
    },
  })
}
