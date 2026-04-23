import type { Client } from '../../clients/createClient.js'

export type ShutdownReturnType = void

export async function shutdown(client: Client): Promise<ShutdownReturnType> {
  await client.request({ method: 'shutdown' })
}
