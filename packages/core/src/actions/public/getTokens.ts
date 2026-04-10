import type { Client } from '../../clients/createClient.js'

export type GetTokensReturnType = unknown[]

export async function getTokens(client: Client): Promise<GetTokensReturnType> {
  return client.request({ method: 'getTokens' }) as Promise<GetTokensReturnType>
}
