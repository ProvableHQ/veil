import type { Transport } from '../types/transport.js'
import { createClient, type Client } from './createClient.js'
import { testActions, type TestActions } from './decorators/test.js'

export type TestClientConfig = {
  transport: Transport
  key?: string | undefined
  name?: string | undefined
}

export type TestClient = Client & TestActions

export function createTestClient(config: TestClientConfig): TestClient {
  const { key = 'test', name = 'Test Client', ...rest } = config
  const client = createClient({ ...rest, key, name })
  return client.extend(testActions) as TestClient
}
