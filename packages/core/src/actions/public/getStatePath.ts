import type { Client } from '../../clients/createClient.js'

export type GetStatePathParameters = { commitment: string }
export type GetStatePathReturnType = unknown

export async function getStatePath(
  client: Client,
  params: GetStatePathParameters,
): Promise<GetStatePathReturnType> {
  return client.request({
    method: 'getStatePath',
    params: { commitment: params.commitment },
  })
}
