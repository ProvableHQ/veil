import type { Client } from '../../clients/createClient.js'
import type { Network } from '../../types/wallet.js'

/**
 * Parameters for `walletClient.switchChain`.
 *
 * @property network Network to switch to, e.g. `'mainnet'` or `'testnet'`.
 */
export type SwitchChainParameters = {
  network: Network
}

/** Resolves with no value once the client targets the new network. */
export type SwitchChainReturnType = void

/**
 * Switch the connected wallet to a different network.
 *
 * - **RPC accounts**: forwards to the wallet adapter, which prompts the user.
 * - **Local accounts**: reloads the proving SDK for the new network and
 *   updates the transport's network routing in-place. The account itself
 *   stays the same — Aleo private keys, view keys, and addresses are
 *   network-agnostic. Requires the proving config to expose `switchNetwork`
 *   (provided by `@veil/provable-sdk`).
 *
 * @param client Wallet client to re-target.
 * @param params The network to switch to.
 *
 * @example
 * await walletClient.switchChain({ network: 'mainnet' })
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
