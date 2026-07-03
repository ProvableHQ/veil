import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for `testClient.advanceBlock`.
 *
 * @property count Optional number of blocks to mine. Defaults to 1.
 */
export type AdvanceBlockParameters = {
  count?: number | undefined
}

/** Resolves with no value once the devnode has produced the blocks. */
export type AdvanceBlockReturnType = void

/**
 * Mines blocks on a local devnode to move the chain forward.
 *
 * Reach for this in tests that need a pending transaction confirmed or a
 * height-gated condition met without waiting for real block production. Hits
 * the devnode over the transport; the devnode MUST be running with
 * `--manual-block-creation`. Real networks do not expose this.
 *
 * @param client Test client whose transport points at a devnode.
 * @param params Optional block count. Omitting it mines a single block.
 * @throws If the transport does not reach a devnode that accepts block-creation requests.
 *
 * @example
 * await testClient.advanceBlock({ count: 5 })
 */
export async function advanceBlock(
  client: Client,
  params: AdvanceBlockParameters = {},
): Promise<AdvanceBlockReturnType> {
  await client.request({ method: 'advanceBlock', params: { count: params.count ?? 1 } })
}
