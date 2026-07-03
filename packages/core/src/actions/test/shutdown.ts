import type { Client } from '../../clients/createClient.js'

/** Resolves with no value once the devnode has acknowledged the shutdown request. */
export type ShutdownReturnType = void

/**
 * Asks a local devnode to stop accepting work and exit.
 *
 * Use in test teardown so the node's port is free for the next run.
 * Hits the devnode over the transport; the process exits shortly after the
 * request is acknowledged, so subsequent requests on this client fail.
 *
 * @param client Test client whose transport points at a devnode.
 *
 * @example
 * await testClient.shutdown()
 */
export async function shutdown(client: Client): Promise<ShutdownReturnType> {
  await client.request({ method: 'shutdown' })
}
