import { TransportError } from '../errors/errors.js'
import type { Transport } from '../types/transport.js'
import { createTransport } from './createTransport.js'

/**
 * Combines transports into one that tries each in order until a request succeeds.
 *
 * Reach for this to pair a primary transport with backups — the typical case is
 * `[walletAdapter, http(url, { network })]`, where the wallet handles writes and
 * HTTP serves reads. On a call it invokes each transport in turn and returns the
 * first success; the returned transport is pure until called. Network is
 * inherited from the first supplied transport that declares one.
 *
 * @param transports Transports to try in order, most preferred first.
 * @returns A transport of type `'fallback'` that fails over across `transports`.
 * @throws {TransportError} If every transport throws; the error message carries
 *   the first transport's error, which is set as its `cause`.
 *
 * @example
 * import { fallback, http, custom } from '@veil/core'
 *
 * const transport = fallback([
 *   custom({ request: (args) => wallet.request(args) }),
 *   http('https://api.provable.com/v2', { network: 'mainnet' }),
 * ])
 */
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
