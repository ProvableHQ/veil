import type { Client } from '../../clients/createClient.js'

export type GetChainIdReturnType = string

/**
 * Returns the current network/chain ID from the connected wallet.
 *
 * On Aleo this returns the network string (e.g. 'mainnet', 'testnet').
 * Equivalent to viem's getChainId for EVM chains.
 */
export async function getChainId(
  client: Client,
): Promise<GetChainIdReturnType> {
  return client.request({
    method: 'getChainId',
    params: {},
  }) as Promise<string>
}

/** Alias for getChainId — matches Aleo terminology */
export const getNetwork = getChainId
