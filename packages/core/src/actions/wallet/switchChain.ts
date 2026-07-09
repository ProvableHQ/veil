import type { Client } from '../../clients/createClient.js'
import type { Network } from '../../types/wallet.js'
import type { RecordProvider } from '../../types/records.js'

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
 * - **Local accounts**: reloads the proving SDK for the new network, re-targets
 *   the attached record provider when it supports `switchNetwork`, and updates
 *   the transport's network routing in-place. The account itself stays the
 *   same — Aleo private keys, view keys, and addresses are network-agnostic.
 *   Requires the proving config to expose `switchNetwork` (provided by
 *   `@veil/provable-sdk`).
 *
 * @param client Wallet client to re-target.
 * @param params The network to switch to.
 * @throws If the proving stack or the record provider cannot switch. When the
 *   provider fails, the proving stack is restored to the previous network and
 *   the transport keeps routing there — the client stays on its old network.
 *
 * @example
 * await walletClient.switchChain({ network: 'mainnet' })
 */
export async function switchChain(
  client: Client,
  params: SwitchChainParameters,
): Promise<SwitchChainReturnType> {
  if (client.account?.type === 'local') {
    const previousNetwork = client.transport.config?.network
    if (client.proving?.switchNetwork) {
      await client.proving.switchNetwork(params.network)
    }
    // Records are chain-scoped: a provider that supports network switching
    // must follow, or requestRecords keeps scanning the previous chain. If
    // the provider fails, restore the proving stack so the client does not
    // end up proving for one network while scanning and routing to another.
    const recordProvider = (client as unknown as { recordProvider?: RecordProvider }).recordProvider
    if (recordProvider?.switchNetwork) {
      try {
        await recordProvider.switchNetwork(params.network)
      } catch (err) {
        if (previousNetwork && client.proving?.switchNetwork) {
          try {
            await client.proving.switchNetwork(previousNetwork)
          } catch {
            // best effort — surface the original failure below
          }
        }
        throw err
      }
    }
    // Mutate transport.config.network last, so reads re-route only once the
    // fallible steps succeeded. The http transport reads this on every request.
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
