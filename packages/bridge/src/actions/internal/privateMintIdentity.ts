import { requireAleoClient, type BridgeChainClients } from '../../connections/resolve.js'
import { BridgeError } from '../../errors/bridgeErrors.js'
import type { BridgePlan, BridgeRegistry } from '../../types/protocol.js'
import type { XReservePrivateMintIdentityStore } from '../../utils/xreservePrivateMintStore.js'
import { reserveXReservePrivateMintIdentity } from '../../utils/xreservePrivateMintStore.js'
import { xReserveViewKeyToScalar } from '../../utils/xreserve.js'
import { resolveTransferRoute } from './resolveTransferRoute.js'

/**
 * Resolves or reserves the public commitment used by a private EVM-to-Aleo deposit.
 *
 * Local derivation saves the scalar before returning its public commitment.
 * Explicit nonce sources skip allocation. This helper makes no network calls.
 *
 * @param registry Reviewed route and wrapper deployment configuration.
 * @param clients Chain capabilities containing the local recipient's view key.
 * @param store Shared identity persistence. Required before local derivation; bound actions supply their client store.
 * @param plan Private transfer identifying the recipient, network, and wrapper.
 * @param suppliedCommitment Optional canonical 32-byte lowercase hexadecimal commitment. Skips local derivation when present.
 * @param suppliedSecretNonce Optional caller-managed scalar. Skips local derivation when present.
 * @returns The supplied or persisted public commitment, or `undefined` when local derivation does not apply.
 * @throws BridgeError When local derivation lacks a store, wrapper metadata is invalid, or identity allocation fails.
 * @example
 * const commitment = await resolvePrivateMintAddressCommitment(registry, clients, store, plan)
 */
export async function resolvePrivateMintAddressCommitment(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  store: XReservePrivateMintIdentityStore | undefined,
  plan: BridgePlan,
  suppliedCommitment?: string,
  suppliedSecretNonce?: string,
): Promise<string | undefined> {
  if (plan.protocol !== 'xreserve' || plan.mintMode !== 'private') return undefined
  if (suppliedCommitment !== undefined || suppliedSecretNonce !== undefined) return suppliedCommitment
  const route = resolveTransferRoute(registry, plan)
  if (route.sourceChain.family !== 'evm' || route.destinationChain.family !== 'aleo') return undefined
  if (!clients[route.destinationChain.id]) return undefined
  const aleo = requireAleoClient(registry, clients, route.destinationChain.id)
  const account = aleo.walletClient?.account
  // RPC wallets do not expose their view key. Preserve the existing explicit
  // secret path for those clients; local clients derive and reserve by default.
  if (account?.type !== 'local' || !account.viewKey) return undefined
  if (!store) {
    throw new BridgeError(
      'Standalone local private mints require circle.privateMintIdentities. Supply a shared identity store or use createBridgeClient.',
    )
  }
  const wrapperProgram = route.route.metadata?.wrapperProgram
  if (typeof wrapperProgram !== 'string' || !wrapperProgram.endsWith('.aleo')) {
    throw new BridgeError(`xReserve wrapper program is invalid: ${route.route.id}`)
  }
  const identity = await reserveXReservePrivateMintIdentity({
    store,
    viewKeyScalar: await xReserveViewKeyToScalar(account.viewKey, plan.route.environment),
    recipient: plan.recipient,
    environment: plan.route.environment,
    program: wrapperProgram,
  })
  return identity.addressCommitment
}
