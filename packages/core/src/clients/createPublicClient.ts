import { createClient, type ClientConfig, type Client } from './createClient.js'
import { publicActions, type PublicActions } from './decorators/public.js'

/**
 * Configuration for {@link createPublicClient}.
 *
 * A public client only reads chain state, so it takes a transport and optional
 * naming but no account or proving configuration.
 *
 * @property transport Transport that carries read requests to the network.
 * @property key Optional identifier for the client's type. Defaults to `"public"`.
 * @property name Optional human-readable name. Defaults to `"Public Client"`.
 */
export type PublicClientConfig = Omit<ClientConfig, 'account' | 'key' | 'name' | 'proving'> & {
  key?: string | undefined
  name?: string | undefined
}

/**
 * A base {@link Client} extended with the read-only public actions
 * (`getBlockNumber`, `getBalance`, `readContract`, and the rest).
 */
export type PublicClient = Client & PublicActions

/**
 * Creates a read-only client for querying Aleo chain state.
 *
 * Reach for this to read blocks, transactions, balances, program mappings, and
 * network metrics — anything that does not sign or submit a transaction. The
 * returned client's methods each hit the network through the transport.
 *
 * @param config Transport and optional naming.
 * @returns A client carrying every public action.
 *
 * @example
 * import { createPublicClient, http } from '@veil/core'
 *
 * const client = createPublicClient({
 *   transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
 * })
 * const height = await client.getBlockNumber()
 */
export function createPublicClient(config: PublicClientConfig): PublicClient {
  const { key = 'public', name = 'Public Client', ...rest } = config
  const client = createClient({ ...rest, key, name })
  return client.extend(publicActions) as PublicClient
}
