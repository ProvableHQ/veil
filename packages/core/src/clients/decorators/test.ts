import { advanceBlock, type AdvanceBlockParameters, type AdvanceBlockReturnType } from '../../actions/test/advanceBlock.js'
import { shutdown, type ShutdownReturnType } from '../../actions/test/shutdown.js'
import { getMappingKeysValues, type GetMappingKeysValuesParameters, type GetMappingKeysValuesReturnType } from '../../actions/test/getMappingKeysValues.js'
import { snapshot, type SnapshotParameters, type SnapshotReturnType } from '../../actions/test/snapshot.js'
import { listSnapshots, type ListSnapshotsReturnType } from '../../actions/test/listSnapshots.js'
import type { Client } from '../createClient.js'

/**
 * Devnode-control actions attached to a {@link TestClient}.
 *
 * Each method binds the client to the correspondingly named action for driving a
 * local devnode in tests. See each action's own documentation for parameters,
 * return value, and behavior.
 *
 * @property advanceBlock Mines blocks to move the devnode forward.
 * @property shutdown Stops the devnode.
 * @property getMappingKeysValues Reads every key/value pair in a program mapping.
 * @property snapshot Captures the ledger as a named snapshot.
 * @property listSnapshots Lists the available snapshots.
 */
export type TestActions = {
  advanceBlock: (params?: AdvanceBlockParameters) => Promise<AdvanceBlockReturnType>
  shutdown: () => Promise<ShutdownReturnType>
  getMappingKeysValues: (params: GetMappingKeysValuesParameters) => Promise<GetMappingKeysValuesReturnType>
  snapshot: (params?: SnapshotParameters) => Promise<SnapshotReturnType>
  listSnapshots: () => Promise<ListSnapshotsReturnType>
}

/**
 * Binds the test actions to a client for use with `extend`.
 *
 * {@link createTestClient} applies this; call it directly only when composing a
 * custom client. Each returned method forwards to its action with `client` bound.
 *
 * @param client The client the actions run against; its transport must point at a
 *   devnode.
 * @returns The test actions bound to `client`.
 *
 * @example
 * import { createClient, http } from '@provablehq/veil-core'
 *
 * const client = createClient({
 *   transport: http('http://127.0.0.1:3030'),
 * }).extend(testActions)
 */
export function testActions(client: Client): TestActions {
  return {
    advanceBlock: (params) => advanceBlock(client, params),
    shutdown: () => shutdown(client),
    getMappingKeysValues: (params) => getMappingKeysValues(client, params),
    snapshot: (params) => snapshot(client, params),
    listSnapshots: () => listSnapshots(client),
  }
}
