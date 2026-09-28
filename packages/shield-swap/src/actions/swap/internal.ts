import type { Client } from '@provablehq/veil-core'
import { getSlot } from '../reads/getSlot.js'
import { getTradeControls } from '../reads/getTradeControls.js'
import { resolveDexImports } from '../../utils/imports.js'
import { resolveTokenRoute, tokenIdToProgram } from '../../utils/routing.js'
import type { SwapQuote } from './quote.js'

/** Carries a quote through internal execution without adding public swap parameters. */
export const executionQuote = Symbol('executionQuote')

/** Rechecks quoted execution immediately before starting signing/proving; manual calls are unchanged. */
export function assertExecutionQuote(client: Client, params: object): void {
  const quote = (params as { [executionQuote]?: SwapQuote })[executionQuote]
  if (quote) assertQuote(client, quote)
}

/** Returns the explicitly configured transport network; never guesses a network. */
export function quoteNetwork(client: Client): string {
  const network = client.transport?.config.network
  if (!network) throw new Error('Quotes require a transport with an explicit network')
  return network
}

/** Rejects amounts that cannot represent a positive on-chain u128. */
export function assertQuoteAmount(value: bigint, name: string): void {
  if (typeof value !== 'bigint' || value <= 0n || value >= 1n << 128n) {
    throw new Error(`${name} must be a positive u128 amount in raw base units`)
  }
}

/** Rejects fractional, non-finite and out-of-range slippage values. */
export function assertQuoteSlippage(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error('slippageBps must be a whole number between 0 and 10000')
  }
}

/** Validates unsigned quote terms before network access or execution preparation. */
export function assertQuote(client: Client, q: SwapQuote): void {
  if (!q || q.version !== 1) throw new Error('Unsupported quote version')
  if (q.network !== quoteNetwork(client)) throw new Error('Quote network does not match the client network')
  if (typeof q.program !== 'string' || !/^[a-z][a-z0-9_]*\.aleo$/.test(q.program)) throw new Error('Invalid quote program')
  const now = Date.now()
  if (!Number.isSafeInteger(q.quotedAt) || !Number.isSafeInteger(q.expiresAt) ||
      q.quotedAt > now || q.expiresAt <= q.quotedAt || q.expiresAt - q.quotedAt > 60_000) {
    throw new Error('Invalid quote timestamps')
  }
  if (q.expiresAt <= now) throw new Error('Quote expired; request a new quote')
  assertQuoteAmount(q.amountIn, 'amountIn')
  assertQuoteAmount(q.expectedOut, 'expected output')
  assertQuoteAmount(q.minOut, 'minimum output')
  assertQuoteSlippage(q.slippageBps)
  if (q.minOut !== q.expectedOut * BigInt(10_000 - q.slippageBps) / 10_000n) {
    throw new Error('Quote minimum output does not match its estimate and slippage')
  }
  if (!Number.isSafeInteger(q.protocolRevision) || q.protocolRevision < 0 ||
      (q.protocolConfigObservedBlock !== undefined && (!Number.isSafeInteger(q.protocolConfigObservedBlock) || q.protocolConfigObservedBlock < 0))) {
    throw new Error('Invalid quote protocol metadata')
  }
  const isField = (value: unknown): value is string => typeof value === 'string' && /^\d+field$/.test(value)
  for (const token of [q.from, q.to]) {
    if (!token || !isField(token.id) || typeof token.symbol !== 'string' ||
        !Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 255) {
      throw new Error('Invalid quote token metadata')
    }
  }
  if (!Array.isArray(q.hops) || q.hops.length < 1 || q.hops.length > 3 || q.from.id === q.to.id) {
    throw new Error('Quote route must connect different tokens through 1–3 hops')
  }
  let current = q.from.id
  const pools = new Set<string>()
  const tokens = new Set([current])
  for (const hop of q.hops) {
    if (!hop || !isField(hop.poolKey) || !isField(hop.tokenOutId) || hop.tokenInId !== current ||
        pools.has(hop.poolKey) || tokens.has(hop.tokenOutId)) {
      throw new Error('Quote route contains a disconnected, repeated or invalid hop')
    }
    pools.add(hop.poolKey)
    tokens.add(hop.tokenOutId)
    current = hop.tokenOutId
  }
  if (current !== q.to.id) throw new Error('Quote route does not reach the output token')
}

/** Checks only quoted pools on chain, then resolves program sources for execution. */
export async function prepareQuote(client: Client, q: SwapQuote, imports?: Record<string, string>): Promise<Record<string, string>> {
  await Promise.all(q.hops.map(async (hop) => {
    const [slot, controls] = await Promise.all([
      getSlot(client, { poolKey: hop.poolKey, program: q.program }),
      getTradeControls(client, { poolKey: hop.poolKey, program: q.program }),
    ])
    const pair = [controls.token0.tokenId, controls.token1.tokenId]
    if (!pair.includes(hop.tokenInId) || !pair.includes(hop.tokenOutId)) {
      throw new Error(`Quote hop ${hop.poolKey} does not match its on-chain pool`)
    }
    if (!controls.tradeable) throw new Error(`Quote pool ${hop.poolKey} is paused or not tradeable`)
    if (!slot || slot.liquidity === 0n) throw new Error(`Quote pool ${hop.poolKey} has no active liquidity`)
  }))
  // An explicit imports map is the same offline/prover escape hatch as manual swaps.
  if (imports) return imports
  const ids = new Set(q.hops.flatMap((hop) => [hop.tokenInId, hop.tokenOutId]))
  const programs = new Set<string>()
  await Promise.all([...ids].map(async (tokenId) => {
    const program = tokenIdToProgram(tokenId)
    if (!program) throw new Error(`Cannot resolve program for quote token ${tokenId}; supply imports explicitly`)
    programs.add(program)
    const route = await resolveTokenRoute(client, { tokenId, program: q.program })
    if (route.wrapped) programs.add(route.underlyingProgram)
  }))
  return resolveDexImports(client, { tokenPrograms: [...programs], program: q.program })
}
