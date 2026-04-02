import type { Client } from '../../clients/createClient.js'

export type GetBalanceParameters = { address: string }
export type GetBalanceReturnType = bigint

export async function getBalance(client: Client, params: GetBalanceParameters): Promise<GetBalanceReturnType> {
  const value = await client.request({ method: 'getBalance', params: { address: params.address } })
  // Aleo REST API returns microcredits as a string with u64 suffix (e.g. "1000000u64")
  const raw = String(value)
  const stripped = raw.replace(/u\d+$/, '')
  return BigInt(stripped)
}
