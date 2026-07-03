import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link getBlockHeightByHash}.
 *
 * @property hash Block hash (`ab1...`) whose height to resolve.
 */
export type GetBlockHeightByHashParameters = { hash: string }

/** Height (u32) of the block with the given hash. */
export type GetBlockHeightByHashReturnType = number

/**
 * Resolves a block hash to its height.
 *
 * Queries the connected Aleo node, so it hits the network. Applies when an
 * API returned a block hash but the height is needed, e.g. to page through
 * neighbouring blocks with `getBlocks`.
 *
 * @param client Client whose transport serves the query.
 * @param params Block hash to resolve.
 * @returns The height (u32) of the matching block.
 *
 * @example
 * const height = await client.getBlockHeightByHash({ hash: 'ab1...' })
 */
export async function getBlockHeightByHash(
  client: Client,
  params: GetBlockHeightByHashParameters,
): Promise<GetBlockHeightByHashReturnType> {
  return client.request({
    method: 'getBlockHeightByHash',
    params: { hash: params.hash },
  }) as Promise<GetBlockHeightByHashReturnType>
}
