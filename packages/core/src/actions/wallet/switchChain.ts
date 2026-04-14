import type { Client } from '../../clients/createClient.js'

export type SwitchChainParameters = {
  network: 'mainnet' | 'testnet'
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
