import { advanceBlock, type AdvanceBlockParameters, type AdvanceBlockReturnType } from '../../actions/test/advanceBlock.js'
import { shutdown, type ShutdownReturnType } from '../../actions/test/shutdown.js'
import { getMappingContents, type GetMappingContentsParameters, type GetMappingContentsReturnType } from '../../actions/test/getMappingContents.js'
import type { Client } from '../createClient.js'

export type TestActions = {
  advanceBlock: (params?: AdvanceBlockParameters) => Promise<AdvanceBlockReturnType>
  shutdown: () => Promise<ShutdownReturnType>
  getMappingContents: (params: GetMappingContentsParameters) => Promise<GetMappingContentsReturnType>
}

export function testActions(client: Client): TestActions {
  return {
    advanceBlock: (params) => advanceBlock(client, params),
    shutdown: () => shutdown(client),
    getMappingContents: (params) => getMappingContents(client, params),
  }
}
