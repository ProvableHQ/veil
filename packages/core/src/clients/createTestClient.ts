import type { Transport } from '../types/transport.js'
import { createClient, type Client } from './createClient.js'
import { testActions, type TestActions } from './decorators/test.js'

/**
 * Configuration for {@link createTestClient}.
 *
 * @property transport Transport pointing at a local devnode.
 * @property key Optional identifier for the client's type. Defaults to `"test"`.
 * @property name Optional human-readable name. Defaults to `"Test Client"`.
 */
export type TestClientConfig = {
  transport: Transport
  key?: string | undefined
  name?: string | undefined
}

/**
 * A base {@link Client} extended with the test actions (`advanceBlock`,
 * `shutdown`, `getMappingKeysValues`) for driving a local devnode.
 */
export type TestClient = Client & TestActions

/**
 * Creates a client for controlling a local devnode in tests.
 *
 * Applies when a test against a devnode needs to advance blocks, read raw
 * mapping key/value pairs, or shut the node down — operations a real network does
 * not expose. Its methods hit the local node through the transport.
 *
 * @param config Transport for the devnode and optional naming.
 * @returns A client carrying every test action.
 *
 * @example
 * import { createTestClient, http } from '@veil/core'
 *
 * const client = createTestClient({
 *   transport: http('http://127.0.0.1:3030'),
 * })
 * await client.advanceBlock()
 */
export function createTestClient(config: TestClientConfig): TestClient {
  const { key = 'test', name = 'Test Client', ...rest } = config
  const client = createClient({ ...rest, key, name })
  return client.extend(testActions) as TestClient
}
