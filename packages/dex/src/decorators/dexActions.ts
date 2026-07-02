import type { Client } from '@veil/core'
import { getPool, type GetPoolParameters, type GetPoolReturnType } from '../actions/reads/getPool.js'
import { getSlot, type GetSlotParameters, type GetSlotReturnType } from '../actions/reads/getSlot.js'
import {
  getSwapOutput,
  type GetSwapOutputParameters,
  type GetSwapOutputReturnType,
} from '../actions/reads/getSwapOutput.js'
import {
  isBlindedAddressUsed,
  isPoolInitialized,
  isFeeTierValid,
  isTickSpacingValid,
  getFeeToTickSpacing,
} from '../actions/reads/validation.js'
import { swapPrivate, type SwapPrivateParameters, type SwapPrivateReturnType } from '../actions/swap/swapPrivate.js'
import {
  claimSwapOutputPrivate,
  type ClaimSwapOutputPrivateParameters,
  type ClaimSwapOutputPrivateReturnType,
} from '../actions/swap/claimSwapOutputPrivate.js'
import { createPool, type CreatePoolParameters, type CreatePoolReturnType } from '../actions/liquidity/createPool.js'
import { mintPrivate, type MintPrivateParameters, type MintPrivateReturnType } from '../actions/liquidity/mintPrivate.js'
import {
  increaseLiquidityPrivate,
  type IncreaseLiquidityPrivateParameters,
  type IncreaseLiquidityPrivateReturnType,
} from '../actions/liquidity/increaseLiquidityPrivate.js'
import {
  getOwnBalances,
  type GetOwnBalancesParameters,
  type GetOwnBalancesReturnType,
} from '../utils/records.js'
import { pickInsertHint, type PickInsertHintParameters } from '../utils/tick-hints.js'
import { IndexerClient, type IndexerClientOptions } from '../indexer/client.js'

/**
 * Configuration for {@link dexActions}.
 *
 * @property indexer Off-chain indexer wiring: constructor options, a
 *   preconstructed `IndexerClient` (e.g. one already holding a JWT), or
 *   omitted for a chain-only client whose `.indexer` throws on first use.
 * @property program shield_swap program id every action defaults to. Set it
 *   once to point the whole surface at another deployment; per-call
 *   `program` still overrides.
 */
export type DexActionsConfig = {
  indexer?: IndexerClientOptions | IndexerClient
  program?: string
}

/** The action surface {@link dexActions} adds to a client. */
export type DexActions = {
  getPool: (params: GetPoolParameters) => Promise<GetPoolReturnType>
  getSlot: (params: GetSlotParameters) => Promise<GetSlotReturnType>
  getSwapOutput: (params: GetSwapOutputParameters) => Promise<GetSwapOutputReturnType>
  isBlindedAddressUsed: (params: { address: string; program?: string }) => Promise<boolean>
  isPoolInitialized: (params: { poolKey: string; program?: string }) => Promise<boolean>
  isFeeTierValid: (params: { fee: number; program?: string }) => Promise<boolean>
  isTickSpacingValid: (params: { tickSpacing: number; program?: string }) => Promise<boolean>
  getFeeToTickSpacing: (params: { fee: number; program?: string }) => Promise<number | null>
  getOwnBalances: (params: GetOwnBalancesParameters) => Promise<GetOwnBalancesReturnType>
  pickInsertHint: (params: PickInsertHintParameters) => Promise<number>
  swapPrivate: (params: SwapPrivateParameters) => Promise<SwapPrivateReturnType>
  claimSwapOutputPrivate: (params: ClaimSwapOutputPrivateParameters) => Promise<ClaimSwapOutputPrivateReturnType>
  createPool: (params: CreatePoolParameters) => Promise<CreatePoolReturnType>
  mintPrivate: (params: MintPrivateParameters) => Promise<MintPrivateReturnType>
  increaseLiquidityPrivate: (params: IncreaseLiquidityPrivateParameters) => Promise<IncreaseLiquidityPrivateReturnType>
  indexer: IndexerClient
}

/**
 * Builds the DEX decorator for `client.extend()`.
 *
 * One surface, two provenances: chain-direct reads and writes sit flat on
 * the client (consensus-backed — the money path); the off-chain indexer's
 * REST methods live under `.indexer`, so a call site always shows which
 * world a value came from. Omit `indexer` for a chain-only client.
 *
 * @param config Indexer wiring and the default program.
 * @returns A decorator: pass it to `client.extend(...)`.
 *
 * @example
 * const client = createWalletClient({ account, transport, proving })
 *   .extend(dexActions({ indexer: {} }))
 * const pool = await client.getPool({ poolKey })       // chain
 * const pools = await client.indexer.getPools()        // REST
 */
export function dexActions(config: DexActionsConfig = {}) {
  const indexer =
    config.indexer instanceof IndexerClient
      ? config.indexer
      : config.indexer
        ? new IndexerClient(config.indexer)
        : undefined

  // Thread the client-level program default under any per-call override.
  const withProgram = <P extends { program?: string }>(p: P): P => ({ ...p, program: p.program ?? config.program })

  // `extend()` copies properties with Object.assign, which evaluates getters
  // eagerly — so the "no indexer" case is a proxy that throws actionably on
  // first USE instead of a lazy getter (which would throw at extend time).
  const missingIndexer = new Proxy({} as IndexerClient, {
    get() {
      throw new Error(
        'No indexer configured — pass dexActions({ indexer: { baseUrl } }) or construct an IndexerClient yourself.',
      )
    },
  })

  return (client: Client): DexActions => ({
    getPool: (p) => getPool(client, withProgram(p)),
    getSlot: (p) => getSlot(client, withProgram(p)),
    getSwapOutput: (p) => getSwapOutput(client, withProgram(p)),
    isBlindedAddressUsed: (p) => isBlindedAddressUsed(client, withProgram(p)),
    isPoolInitialized: (p) => isPoolInitialized(client, withProgram(p)),
    isFeeTierValid: (p) => isFeeTierValid(client, withProgram(p)),
    isTickSpacingValid: (p) => isTickSpacingValid(client, withProgram(p)),
    getFeeToTickSpacing: (p) => getFeeToTickSpacing(client, withProgram(p)),
    getOwnBalances: (p) => getOwnBalances(client, p),
    pickInsertHint: (p) => pickInsertHint(client, withProgram(p)),
    swapPrivate: (p) => swapPrivate(client, withProgram(p)),
    claimSwapOutputPrivate: (p) => claimSwapOutputPrivate(client, p),
    createPool: (p) => createPool(client, withProgram(p)),
    mintPrivate: (p) => mintPrivate(client, withProgram(p)),
    increaseLiquidityPrivate: (p) => increaseLiquidityPrivate(client, withProgram(p)),
    indexer: indexer ?? missingIndexer,
  })
}
