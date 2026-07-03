import { advanceBlock, type AdvanceBlockParameters, type AdvanceBlockReturnType } from '../../actions/test/advanceBlock.js'
import { shutdown, type ShutdownReturnType } from '../../actions/test/shutdown.js'
import { getMappingKeysValues, type GetMappingKeysValuesParameters, type GetMappingKeysValuesReturnType } from '../../actions/test/getMappingKeysValues.js'
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
 */
export type TestActions = {
  advanceBlock: (params?: AdvanceBlockParameters) => Promise<AdvanceBlockReturnType>
  shutdown: () => Promise<ShutdownReturnType>
  getMappingKeysValues: (params: GetMappingKeysValuesParameters) => Promise<GetMappingKeysValuesReturnType>
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
 * import { createClient, http } from '@veil/core'
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
  }
}
