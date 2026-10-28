import { execute } from '../../actions/execute.js'
import { quote } from '../../actions/quote.js'
import { complete } from '../../actions/complete.js'
import { getStatus } from '../../actions/getStatus.js'
import { recover } from '../../actions/recover.js'
import { resume } from '../../actions/resume.js'
import { wait } from '../../actions/wait.js'
import { shield } from '../../actions/shield.js'
import { unshield } from '../../actions/unshield.js'
import type { BridgeChainClients } from '../../connections/resolve.js'
import type { BridgeProgress, BridgeReceipt, BridgeRegistry } from '../../types/protocol.js'
import type { CompleteParameters, ExecuteParameters, GetStatusParameters, QuoteParameters, RecoverParameters, ResumeParameters, WaitParameters, BridgeExecution, BridgeQuote } from '../../types/actions.js'
import type { AleoPrivacyExecution, ShieldParameters, UnshieldParameters } from '../../types/aleo.js'
import {
  memoryXReservePrivateMintIdentityStore,
  type XReservePrivateMintIdentityStore,
} from '../../utils/xreservePrivateMintStore.js'

/**
 * Circle-specific configuration shared by every bound action.
 *
 * @property privateMintIdentities Counter and scalar persistence for locally derived private USDCx identities. Supplied as the default `circle.privateMintIdentities` of quote, execute, and complete. Defaults to memory for local identities; an implicit memory store does not claim externally managed commitments.
 */
export type CircleBridgeConfig = {
  privateMintIdentities?: XReservePrivateMintIdentityStore | undefined
}

/**
 * Carries validated registry and materialized client state into bound actions.
 * @property registry Validated deployment registry.
 * @property clients Materialized chain capabilities keyed by registry chain id.
 * @property fetch Fetch implementation used for protocol HTTP requests.
 * @property circle Optional Circle-specific configuration. Defaults to a memory identity store.
 */
export type BridgeActionsConfig = {
  registry: BridgeRegistry
  clients: BridgeChainClients
  fetch: typeof globalThis.fetch
  circle?: CircleBridgeConfig | undefined
}

/**
 * Groups the complete cross-chain transfer lifecycle exposed by a bridge client.
 *
 * Quoting validates the transfer and reads chains or providers where current
 * costs are available. Execution, resumption, completion, shielding, and
 * unshielding can request wallet authorization and move funds.
 */
export type BridgeActions = {
  quote: (params: QuoteParameters) => Promise<BridgeQuote>
  execute: (params: ExecuteParameters) => Promise<BridgeExecution>
  getStatus: (params: GetStatusParameters) => Promise<BridgeReceipt>
  complete: (params: CompleteParameters) => Promise<BridgeExecution>
  recover: (params: RecoverParameters) => Promise<BridgeProgress>
  resume: (params: ResumeParameters) => Promise<BridgeExecution>
  wait: (params: WaitParameters) => Promise<BridgeProgress>
  shield: (params: ShieldParameters) => Promise<AleoPrivacyExecution>
  unshield: (params: UnshieldParameters) => Promise<AleoPrivacyExecution>
}

/**
 * Binds configured chains, wallets, and provider HTTP access to every bridge action.
 *
 * Calling this function only creates closures; it does not contact a chain,
 * request a signature, submit a transaction, move funds, or store state.
 */
export function bridgeActions(config: BridgeActionsConfig): BridgeActions {
  const configuredStore = config.circle?.privateMintIdentities
  const privateMintIdentities = configuredStore ?? memoryXReservePrivateMintIdentityStore()
  // The configured store is the default for every call; a call may still name
  // its own store under `circle`.
  const withStore = <T extends { circle?: { privateMintIdentities?: XReservePrivateMintIdentityStore | undefined } | undefined }>(params: T): T => ({
    ...params,
    circle: {
      ...params.circle,
      privateMintIdentities: params.circle?.privateMintIdentities ?? privateMintIdentities,
    },
  })
  return {
    // Every closure injects the same validated route catalog and
    // registry-keyed clients, preventing per-action configuration drift.
    quote: async (params) => quote(config.registry, config.clients, withStore(params), config.fetch),
    execute: async (params) => {
      // An implicit client store does not own a caller-managed commitment.
      // Explicit client or call stores still request validation against it.
      const external = params.plan.circle?.privateMintIdentitySource === 'external'
        || (params.plan.circle?.privateMintAddressCommitment === undefined && params.circle?.privateMintAddressCommitment !== undefined)
      const actionParams = external && configuredStore === undefined
        ? params
        : withStore(params)
      return execute(config.registry, config.clients, actionParams, config.fetch)
    },
    getStatus: async (params) => getStatus(config.registry, config.clients, config.fetch, params),
    complete: async (params) => complete(config.registry, config.clients, withStore(params), config.fetch),
    recover: async (params) => recover(config.registry, config.clients, config.fetch, params),
    resume: async (params) => resume(config.registry, config.clients, params, config.fetch),
    wait: async (params) => wait(config.registry, config.clients, config.fetch, params),
    shield: async (params) => shield(config.registry, config.clients, params),
    unshield: async (params) => unshield(config.registry, config.clients, params),
  }
}
