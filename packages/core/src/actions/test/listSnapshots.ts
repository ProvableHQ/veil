import type { Client } from '../../clients/createClient.js'

/** The snapshot names a devnode reports, in the order it returns them. */
export type ListSnapshotsReturnType = string[]

/**
 * Lists the snapshots available on a local devnode.
 *
 * Use in tests to discover a snapshot name to pass to the `@veil/devnode`
 * `restoreDevnode` action. Hits the devnode over the transport. Real networks
 * do not expose this.
 *
 * @param client Test client whose transport points at a devnode.
 * @returns The snapshot names, in the order the node reports them.
 * @throws If the transport does not reach a devnode that accepts the request.
 *
 * @example
 * const names = await testClient.listSnapshots()
 * // ['snapshot-42', 'before-deploy']
 */
export async function listSnapshots(client: Client): Promise<ListSnapshotsReturnType> {
  return client.request({ method: 'listSnapshots' }) as Promise<ListSnapshotsReturnType>
}
