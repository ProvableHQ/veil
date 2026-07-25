// Wrapped-token routing resolution.
//
// The core AMM only accepts wrapped-token operations from its routers, and
// the authoritative wrapped-token test is on-chain membership in the
// `from_wrapper_token_id` mapping. Actions resolve a token's route once and
// dispatch to the core or a router accordingly — callers never name
// wrappers.

import { readMapping, type Client } from '@provablehq/veil-core'
import { SHIELD_SWAP } from '../constants.js'

/**
 * How the AMM reaches a token: directly (plain ARC-20) or through its
 * wrapper relationship.
 *
 * @property tokenId The AMM-facing token id as a `field` literal.
 * @property wrapped True when the token is a registered wrapper whose
 *   operations must route through the swap/LP routers.
 * @property underlyingId Underlying token id (`field` literal) — the asset
 *   the user actually holds records of.
 * @property wrapperProgram The wrapper program (decoded from `tokenId`).
 * @property underlyingProgram The underlying program (decoded from
 *   `underlyingId`, e.g. `credits.aleo`).
 */
export type TokenRoute =
  | { tokenId: string; wrapped: false }
  | { tokenId: string; wrapped: true; underlyingId: string; wrapperProgram: string; underlyingProgram: string }

/**
 * Decodes a token id back to the program that owns it. Wrapper and plain
 * ARC-20 token ids are the little-endian field encoding of the bare program
 * name (`test_arc20_eth` → `test_arc20_eth.aleo`).
 *
 * @param tokenId Token id as a decimal string or `field` literal.
 * @returns The `.aleo` program id, or undefined when the field does not
 *   decode to a valid program name.
 */
export function tokenIdToProgram(tokenId: string): string | undefined {
  const digits = tokenId.replace(/field$/, '')
  if (!/^\d+$/.test(digits)) return undefined
  let value = BigInt(digits)
  const bytes: number[] = []
  while (value > 0n) {
    bytes.push(Number(value & 0xffn))
    value >>= 8n
  }
  const name = String.fromCharCode(...bytes)
  if (!/^[a-z][a-z0-9_]*$/.test(name)) return undefined
  return `${name}.aleo`
}

/**
 * Encodes a program id to its AMM token id — the inverse of
 * {@link tokenIdToProgram}.
 *
 * @param programId Program id with or without the `.aleo` suffix.
 * @returns The token id as a `field` literal.
 */
export function programToTokenId(programId: string): string {
  const name = programId.replace(/\.aleo$/, '')
  let value = 0n
  for (let i = name.length - 1; i >= 0; i--) {
    value = (value << 8n) | BigInt(name.charCodeAt(i))
  }
  return `${value}field`
}

// Wrapper relationships are immutable once registered (`allow_token` rejects
// re-registration), so resolutions cache for the process lifetime.
const routeCache = new Map<string, TokenRoute>()

/** Empties the route cache — for tests and long-lived processes that switch networks. */
export function clearRouteCache(): void {
  routeCache.clear()
}

/**
 * Parameters for {@link resolveTokenRoute}.
 *
 * @property tokenId AMM token id as a decimal string or `field` literal.
 * @property program AMM program carrying the wrapper mappings. Defaults to
 *   `shield_swap.aleo`.
 * @property route Pre-resolved route to use instead of reading the chain —
 *   the offline/override escape hatch; when set, no request is made.
 */
export interface ResolveTokenRouteParameters {
  tokenId: string
  program?: string
  route?: TokenRoute
}

/**
 * Resolves whether a token is wrapped and, when it is, the underlying asset
 * the caller's records must come from.
 *
 * Reads `from_wrapper_token_id[tokenId]` on the AMM — presence is the
 * on-chain definition of "wrapped". Results cache for the process lifetime
 * (relationships are immutable). Hits the network on the first resolution of
 * each token unless `route` is supplied.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params Token to resolve, optional program override, optional
 *   pre-resolved route.
 * @returns The token's route.
 *
 * @example
 * const route = await resolveTokenRoute(client, { tokenId: pool.token0 })
 * if (route.wrapped) console.log('records come from', route.underlyingProgram)
 */
export async function resolveTokenRoute(
  client: Client,
  params: ResolveTokenRouteParameters,
): Promise<TokenRoute> {
  if (params.route) return params.route

  const program = params.program ?? SHIELD_SWAP
  const tokenId = params.tokenId.endsWith('field') ? params.tokenId : `${params.tokenId}field`
  const cacheKey = `${program}/${tokenId}`
  const cached = routeCache.get(cacheKey)
  if (cached) return cached

  const raw = await readMapping(client, { programId: program, mapping: 'from_wrapper_token_id', key: tokenId })
  let route: TokenRoute
  if (raw == null || raw === 'null') {
    route = { tokenId, wrapped: false }
  } else {
    const underlyingId = raw.trim()
    const wrapperProgram = tokenIdToProgram(tokenId)
    const underlyingProgram = tokenIdToProgram(underlyingId)
    if (!wrapperProgram || !underlyingProgram) {
      throw new Error(
        `Wrapper relationship for ${tokenId} does not decode to program names ` +
          `(wrapper: ${wrapperProgram ?? '?'}, underlying: ${underlyingProgram ?? '?'})`,
      )
    }
    route = { tokenId, wrapped: true, underlyingId, wrapperProgram, underlyingProgram }
  }
  routeCache.set(cacheKey, route)
  return route
}
