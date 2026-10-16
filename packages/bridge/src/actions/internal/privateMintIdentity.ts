import { requireAleoClient, type BridgeChainClients } from '../../connections/resolve.js'
import { BridgeError } from '../../errors/bridgeErrors.js'
import type { BridgePlan, BridgeRegistry } from '../../types/protocol.js'
import type { XReservePrivateMintIdentityStore } from '../../utils/xreservePrivateMintStore.js'
import { reserveXReservePrivateMintIdentity } from '../../utils/xreservePrivateMintStore.js'
import { xReserveViewKeyToScalar } from '../../utils/xreserve.js'
import { resolveTransferRoute } from './resolveTransferRoute.js'

/** Resolves or reserves the public commitment used by a private EVM-to-Aleo deposit. */
export async function resolvePrivateMintAddressCommitment(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  store: XReservePrivateMintIdentityStore,
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
