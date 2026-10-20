import type { Client } from '../../clients/createClient.js'

/**
 * Identifies a published compliance tree.
 * @property programId Program owning the freezelist root.
 */
export type GetComplianceFreezeListParameters = { programId: string }

/** Represents decimal tree nodes, ordered from the leaf layer to the root. */
export type GetComplianceFreezeListReturnType = string[]

/**
 * Fetches a published compliance Merkle tree through the client's transport.
 *
 * The caller MUST validate witnesses against the on-chain root before use;
 * the indexer can lag a root update. Does not sign or prove.
 * @param client Client connected to the target network.
 * @param params Program owning the freezelist.
 * @returns Decimal tree nodes; an empty array represents an empty list.
 * @throws When the endpoint fails or returns invalid node values.
 * @example
 * const tree = await getComplianceFreezeList(client, { programId: 'usdcx_freezelist.aleo' })
 */
export async function getComplianceFreezeList(client: Client, params: GetComplianceFreezeListParameters): Promise<GetComplianceFreezeListReturnType> {
  const tree = await client.request({ method: 'getComplianceFreezeList', params })
  if (!Array.isArray(tree) || !tree.every(node => typeof node === 'string' && /^\d+$/.test(node))) {
    throw new Error('Invalid compliance tree: expected decimal field strings')
  }
  return tree
}
