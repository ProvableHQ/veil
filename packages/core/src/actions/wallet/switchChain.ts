import type { Client } from '../../clients/createClient.js'
import type { Network } from '../../types/wallet.js'

export type SwitchChainParameters = {
  network: Network
}

export type SwitchChainReturnType = void

export async function switchChain(
  client: Client,
  params: SwitchChainParameters,
): Promise<SwitchChainReturnType> {
  await client.request({
    method: 'switchNetwork',
    params: { network: params.network },
  })
}

/** Alias for switchChain — matches Aleo wallet adapter terminology */
export const switchNetwork = switchChain
