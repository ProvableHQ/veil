import type { Client } from '../../clients/createClient.js'

export type AdvanceBlockParameters = {
  count?: number | undefined
}

export type AdvanceBlockReturnType = void

export async function advanceBlock(
  client: Client,
  params: AdvanceBlockParameters = {},
): Promise<AdvanceBlockReturnType> {
  await client.request({ method: 'advanceBlock', params: { count: params.count ?? 1 } })
}
