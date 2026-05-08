import { advanceBlock, type AdvanceBlockParameters, type AdvanceBlockReturnType } from '../../actions/test/advanceBlock.js'
import { shutdown, type ShutdownReturnType } from '../../actions/test/shutdown.js'
import { getMappingKeysValues, type GetMappingKeysValuesParameters, type GetMappingKeysValuesReturnType } from '../../actions/test/getMappingKeysValues.js'
import type { Client } from '../createClient.js'

export type TestActions = {
  advanceBlock: (params?: AdvanceBlockParameters) => Promise<AdvanceBlockReturnType>
  shutdown: () => Promise<ShutdownReturnType>
  getMappingKeysValues: (params: GetMappingKeysValuesParameters) => Promise<GetMappingKeysValuesReturnType>
}

export function testActions(client: Client): TestActions {
  return {
    advanceBlock: (params) => advanceBlock(client, params),
    shutdown: () => shutdown(client),
    getMappingKeysValues: (params) => getMappingKeysValues(client, params),
  }
}
