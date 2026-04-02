import { createClient, type ClientConfig, type Client } from './createClient.js'
import { publicActions, type PublicActions } from './decorators/public.js'

export type PublicClientConfig = Omit<ClientConfig, 'account' | 'key' | 'name' | 'proving'> & {
  key?: string | undefined
  name?: string | undefined
}

export type PublicClient = Client & PublicActions

export function createPublicClient(config: PublicClientConfig): PublicClient {
  const { key = 'public', name = 'Public Client', ...rest } = config
  const client = createClient({ ...rest, key, name })
  return client.extend(publicActions) as PublicClient
}
