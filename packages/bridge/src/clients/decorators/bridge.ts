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
import type { XReservePrivateMintIdentityStore } from '../../utils/xreservePrivateMintStore.js'

/**
 * Circle-specific configuration shared by every bound action.
 *
 * @property privateMintIdentities Counter and scalar persistence for locally derived private USDCx identities. Supplied as the default `circle.privateMintIdentities` of quote, execute, and complete. Without it, a private mint must name a nonce source on each quote.
 */
export type CircleBridgeConfig = {
  privateMintIdentities?: XReservePrivateMintIdentityStore | undefined
}

/**
 * Carries validated registry and materialized client state into bound actions.
 * @property registry Validated deployment registry.
 * @property clients Materialized chain capabilities keyed by registry chain id.
 * @property fetch Fetch implementation used for protocol HTTP requests.
 * @property circle Optional Circle-specific configuration.
 */
export type BridgeActionsConfig = {
  registry: BridgeRegistry
  clients: BridgeChainClients
  fetch: typeof globalThis.fetch
  circle?: CircleBridgeConfig | undefined
}

/** Resolves to `true` when a config supplies a private mint identity store. */
export type HasPrivateMintStore<Config> =
  Config extends { circle: { privateMintIdentities: XReservePrivateMintIdentityStore } } ? true : false

/**
 * Groups the complete cross-chain transfer lifecycle exposed by a bridge client.
 *
 * Quoting validates the transfer and reads chains or providers where current
 * costs are available. Execution, resumption, completion, shielding, and
 * unshielding can request wallet authorization and move funds. `HasStore`
 * records whether the client carries a private mint identity store, which
 * decides whether a private quote must name a nonce source itself.
 */
export type BridgeActions<HasStore extends boolean = false> = {
  quote: (params: QuoteParameters<HasStore>) => Promise<BridgeQuote>
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
export function bridgeActions<Config extends BridgeActionsConfig>(config: Config): BridgeActions<HasPrivateMintStore<Config>> {
  const privateMintIdentities = config.circle?.privateMintIdentities
  // The configured store is the default for every call; a call may still name
  // its own store under `circle`. Without either, a private mint fails at quote.
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
    // A store-backed client satisfies the nonce source requirement by injection.
    quote: async (params) => quote(config.registry, config.clients, withStore(params) as QuoteParameters, config.fetch),
    execute: async (params) => execute(config.registry, config.clients, withStore(params), config.fetch),
    getStatus: async (params) => getStatus(config.registry, config.clients, config.fetch, params),
    complete: async (params) => complete(config.registry, config.clients, withStore(params), config.fetch),
    recover: async (params) => recover(config.registry, config.clients, config.fetch, params),
    resume: async (params) => resume(config.registry, config.clients, params, config.fetch),
    wait: async (params) => wait(config.registry, config.clients, config.fetch, params),
    shield: async (params) => shield(config.registry, config.clients, params),
    unshield: async (params) => unshield(config.registry, config.clients, params),
  }
}
