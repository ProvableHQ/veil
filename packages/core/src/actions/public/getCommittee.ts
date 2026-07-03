import type { Client } from '../../clients/createClient.js'
import type { Committee } from '../../types/network.js'

/**
 * Parameters for {@link getCommittee}.
 *
 * @property height Optional block height (u32) to read the committee at.
 *   Defaults to the latest committee. Pass a height to audit historical
 *   validator membership.
 */
export type GetCommitteeParameters = { height?: number }

/** The validator committee, with each member's stake and open/closed status. */
export type GetCommitteeReturnType = Committee

/**
 * Retrieves the validator committee, either current or at a past height.
 *
 * Queries the connected Aleo node, so it hits the network. Reach for it to
 * see which validators are producing blocks and their bonded stake; use
 * `getDelegators` to see who is bonded to a specific validator.
 *
 * @param client Client whose transport serves the query.
 * @param params Optional height selector. Defaults to the latest committee.
 * @returns The committee membership at the requested point in the chain.
 *
 * @example
 * const committee = await client.getCommittee()
 */
export async function getCommittee(
  client: Client,
  params: GetCommitteeParameters = {},
): Promise<GetCommitteeReturnType> {
  return client.request({
    method: 'getCommittee',
    params: { height: params.height },
  }) as Promise<GetCommitteeReturnType>
}
