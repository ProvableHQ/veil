import type { Client } from '../../clients/createClient.js'
import type { TokenPage } from '../../types/network.js'

export type GetTokensReturnType = TokenPage

export async function getTokens(client: Client): Promise<GetTokensReturnType> {
  return client.request({ method: 'getTokens' }) as Promise<GetTokensReturnType>
}
