import type { Client } from '../../clients/createClient.js'
import type { Network } from '../../types/wallet.js'

export type SwitchChainParameters = {
  network: Network
}

export type SwitchChainReturnType = void

/**
 * Switch the connected wallet to a different network.
 *
 * - **RPC accounts**: forwards to the wallet adapter, which prompts the user.
 * - **Local accounts**: reloads the proving SDK for the new network and
 *   updates the transport's network routing in-place. The account itself
 *   stays the same — Aleo private keys, view keys, and addresses are
 *   network-agnostic. Requires the proving config to expose `switchNetwork`
 *   (provided by `@veil/provable`).
 */
export async function switchChain(
  client: Client,
  params: SwitchChainParameters,
): Promise<SwitchChainReturnType> {
  if (client.account?.type === 'local') {
    if (client.proving?.switchNetwork) {
      await client.proving.switchNetwork(params.network)
    }
    // Mutate transport.config.network so reads re-route to the new path
    // segment. The http transport reads this on every request.
    if (client.transport.config) {
      client.transport.config.network = params.network
    }
    return
  }
  await client.request({
    method: 'switchNetwork',
    params: { network: params.network },
  })
}

/** Alias for switchChain — matches Aleo wallet adapter terminology */
export const switchNetwork = switchChain
