import type { Client } from '../../clients/createClient.js'
import type { Network } from '../../types/wallet.js'

export type GetChainIdReturnType = Network

/**
 * Returns the current network/chain ID from the connected wallet.
 *
 * On Aleo this returns the network string (e.g. 'mainnet', 'testnet').
 * Equivalent to viem's getChainId for EVM chains.
 *
 * For local accounts, returns the network configured on the transport. For
 * RPC accounts, asks the wallet adapter via the `getChainId` transport method.
 */
export async function getChainId(
  client: Client,
): Promise<GetChainIdReturnType> {
  if (client.account?.type === 'local') {
    const network = client.transport.config.network
    if (network) return network
  }
  return client.request({
    method: 'getChainId',
    params: {},
  }) as Promise<GetChainIdReturnType>
}

/** Alias for getChainId — matches Aleo terminology */
export const getNetwork = getChainId
