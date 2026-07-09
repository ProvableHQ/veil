import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for `testClient.snapshot`.
 *
 * @property name Optional snapshot name. When omitted, the devnode auto-names it
 *   from the current block height (for example `snapshot-42`).
 */
export type SnapshotParameters = {
  name?: string | undefined
}

/**
 * Result of a snapshot request, mirroring the devnode's JSON response.
 *
 * @property name Name the snapshot was saved under — the requested `name`, or
 *   the auto-generated one when none was requested.
 * @property height Block height at which the ledger was captured. A u32, so a
 *   `number`.
 */
export type SnapshotReturnType = {
  name: string
  height: number
}

/**
 * Captures the current ledger state of a local devnode as a named snapshot.
 *
 * Use in tests to save a point to return to later, then reload it with the
 * `@provablehq/veil-devnode` `restoreDevnode` action. Hits the devnode over the transport;
 * the node MUST be running with persistent storage (`storagePath`) — an
 * in-memory node has nothing to snapshot. Real networks do not expose this.
 *
 * @param client Test client whose transport points at a devnode.
 * @param params Optional snapshot name. Omitting it lets the node auto-name it
 *   from the block height.
 * @returns The saved snapshot's `name` and captured block `height`.
 * @throws If the transport does not reach a devnode, or the node rejects the
 *   request (for example when it lacks persistent storage).
 *
 * @example
 * const { name } = await testClient.snapshot({ name: 'before-deploy' })
 */
export async function snapshot(
  client: Client,
  params: SnapshotParameters = {},
): Promise<SnapshotReturnType> {
  return client.request({
    method: 'snapshot',
    params: { name: params.name },
  }) as Promise<SnapshotReturnType>
}
