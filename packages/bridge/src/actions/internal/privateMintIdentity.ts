import { requireAleoClient, type BridgeChainClients } from '../../connections/resolve.js'
import { BridgeError } from '../../errors/bridgeErrors.js'
import type { BridgePlan, BridgeRegistry } from '../../types/protocol.js'
import type { XReservePrivateMintIdentityStore } from '../../utils/xreservePrivateMintStore.js'
import { reserveXReservePrivateMintIdentity } from '../../utils/xreservePrivateMintStore.js'
import { xReserveViewKeyToScalar } from '../../utils/xreserve.js'
import { resolveTransferRoute } from './resolveTransferRoute.js'

/** Instruction raised when a private mint has nowhere to keep its scalar. */
export const PRIVATE_MINT_NONCE_SOURCE_REQUIRED =
  'A private USDCx mint needs a nonce source so its deposit can be minted later. '
  + 'Configure circle: { privateMintIdentities } on createBridgeClient '
  + '(fileXReservePrivateMintIdentityStore from @provablehq/aleo-bridge-sdk/node is durable), '
  + 'or pass circle.privateMintIdentities, circle.privateMintSecretNonce, or circle.walletPreparedDeposit on the call. '
  + 'See packages/bridge/docs/private-usdcx-mints.md.'

/**
 * Resolves or reserves the public commitment used by a private EVM-to-Aleo deposit.
 *
 * A supplied commitment or legacy secret nonce is returned or honored as-is.
 * Otherwise the configured store derives a fresh identity from the local Aleo
 * account's view key. A private mint with no source at all is rejected before
 * any network call, because a deposit whose scalar is lost cannot be minted.
 *
 * @param registry Route catalog used to locate the wrapper program and chains.
 * @param clients Chain clients; the Aleo destination client must hold a local account with a view key for derivation.
 * @param store Identity store configured on the client or the call, or `undefined` when neither named one.
 * @param plan Prepared transfer; only private xReserve mints from an EVM source resolve anything.
 * @param suppliedCommitment Commitment the caller reserved already. Returned unchanged.
 * @param suppliedSecretNonce Legacy scalar the caller manages. Skips derivation.
 * @returns The commitment to deposit against, or `undefined` when the legacy nonce path or a non-private route applies.
 * @throws BridgeError When a private mint has no nonce source, or the store cannot derive one from the configured Aleo client.
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
  if (store === undefined) throw new BridgeError(PRIVATE_MINT_NONCE_SOURCE_REQUIRED)
  if (!clients[route.destinationChain.id]) {
    throw new BridgeError(
      `The private mint identity store derives from the Aleo account, but clients has no entry for ${route.destinationChain.id}. `
      + 'Add the Aleo client, or pass circle.privateMintSecretNonce or circle.walletPreparedDeposit instead.',
    )
  }
  const aleo = requireAleoClient(registry, clients, route.destinationChain.id)
  const account = aleo.walletClient?.account
  // RPC wallets never expose their view key, so the store cannot derive for them.
  if (account?.type !== 'local' || !account.viewKey) {
    throw new BridgeError(
      'The private mint identity store needs a local Aleo account with a view key. '
      + 'For a connected wallet pass circle.walletPreparedDeposit; otherwise pass circle.privateMintSecretNonce.',
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
