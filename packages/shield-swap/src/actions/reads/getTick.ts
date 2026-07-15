import type { Client } from '@provablehq/veil-core'
import { readStructMapping } from './internal.js'
import { toTick, type Tick } from '../../generated/shield_swap.js'
import { deriveTickKey } from '../../utils/keys.js'

/**
 * Parameters for {@link getTick} — either the pool and tick index (the key
 * is derived locally), or a pre-derived tick key.
 *
 * @property poolKey Pool key field literal. With `tick`, the mapping key is
 *   derived via `deriveTickKey`, which loads the optional `@provablehq/sdk`
 *   peer.
 * @property tick The tick index (i32).
 * @property tickKey A pre-derived tick key field literal. Skips the local
 *   derivation entirely, so a wallet-only bundle without the WASM peer can
 *   still read ticks.
 * @property program Program to read from. Defaults to `DEFAULT_PROGRAM`.
 */
export type GetTickParameters =
  | { poolKey: string; tick: number; tickKey?: undefined; program?: string }
  | { tickKey: string; poolKey?: undefined; tick?: undefined; program?: string }

/** The decoded tick, or `null` when the tick is not initialized. */
export type GetTickReturnType = Tick | null

/**
 * Reads an initialized tick from the on-chain `ticks` mapping.
 *
 * Returns the tick's net/gross liquidity, fee-growth-outside snapshots, and
 * its `prev`/`next` neighbors in the initialized-tick list — the raw
 * material for authoritative insert hints and range fee accounting.
 *
 * Hits the network: one node request via the client's transport. The
 * `poolKey` + `tick` form additionally loads the optional `@provablehq/sdk`
 * peer for the key derivation; pass `tickKey` to stay WASM-free.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params The pool and tick index, or a pre-derived tick key.
 * @returns The decoded tick, or `null` when the tick is not initialized.
 * @throws When the key must be derived and `@provablehq/sdk` is not
 *   installed; a transport error when the node is unreachable; and a decode
 *   error when the mapping value does not parse as a `Tick`.
 *
 * @example
 * const tick = await getTick(client, { poolKey, tick: -600 })
 * // or, without the WASM peer:
 * const tick2 = await getTick(client, { tickKey })
 */
export async function getTick(client: Client, params: GetTickParameters): Promise<GetTickReturnType> {
  // A pre-derived key skips the WASM peer — wallet-only bundles pass tickKey.
  const key = params.tickKey ?? (await deriveTickKey({ pool: params.poolKey, tick: params.tick }))
  return readStructMapping(client, params.program, 'ticks', key, toTick)
}
