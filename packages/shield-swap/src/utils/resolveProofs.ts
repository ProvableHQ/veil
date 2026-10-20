import { getComplianceFreezeList, freezelistProofRequest, type Client, type FreezelistProofInput } from '@provablehq/veil-core'
import { SHIELD_SWAP_FREEZELIST } from '../constants.js'
import { EMPTY_MERKLE_PROOFS, formatMerkleProofPair, proofProviderForAccount, resolveProofInput, type ComplianceProofs, type FreezelistConfig, type ProofContext } from './proofs.js'
import type { TokenRoute } from './routing.js'

/** Maps known underlying token deployments to their compliance lists; credits ignores proofs. */
export const KNOWN_TOKEN_FREEZELISTS: Readonly<Record<string, string | null>> = {
  'credits.aleo': null,
  'usdcx_stablecoin.aleo': 'usdcx_freezelist.aleo',
  'test_usdcx_stablecoin.aleo': 'test_usdcx_freezelist.aleo',
}
const EMPTY_ROOT = '3642222252059314292809609689035560016959342421640560347114299934615987159853field'
const placeholder = formatMerkleProofPair(EMPTY_MERKLE_PROOFS)
type CachedTree = { root: string; tree: Promise<string[]>; proofs: Map<string, Promise<string>> }
const caches = new WeakMap<Client, Map<string, CachedTree>>()

/** Identifies one AMM proof slot; signer slots let wallets select their connected address. */
export function ammProofContext(subject: string, subjectIsSigner = false): ProofContext {
  return { list: 'amm', program: SHIELD_SWAP_FREEZELIST, subject, subjectIsSigner }
}

/** Identifies a wrapped side's proof slot; plain tokens have no wrapper proof. */
export function wrapperProofContext(route: TokenRoute, subject: string, subjectIsSigner = true): ProofContext | undefined {
  return route.wrapped ? { list: 'wrapper', program: route.wrapperProgram, underlyingProgram: route.underlyingProgram, subject, subjectIsSigner } : undefined
}

function listFor(context: ProofContext, config: FreezelistConfig): string | null {
  if (context.list === 'amm') return config.ammFreezelistProgram ?? SHIELD_SWAP_FREEZELIST
  const overrides = config.wrapperFreezelists ?? {}
  const list = config.wrapperFreezelists
    ? overrides[context.program]
    : KNOWN_TOKEN_FREEZELISTS[context.underlyingProgram ?? '']
  if (list === null) return null
  if (!list) throw new Error(`No freezelist configured for wrapper ${context.program}; supply freezelists.wrapperFreezelists explicitly`)
  return list
}

/**
 * Resolves an action's proof slots in ABI order, preserving absent wrapper slots.
 *
 * Literal inputs bypass network reads. Automatic local proofs pin one root per
 * list per call, reuse verified witnesses while that root is current, and bound
 * the per-client memory cache to 16 lists and 256 subjects per list. Wallets
 * receive derived requests and own their proof generation and caching.
 * @param client Supplies the signer, transport and optional local generator.
 * @param source Supplies literals or a provider; null or omission enables automatic resolution.
 * @param contexts Identifies each proof subject in transaction order; undefined slots consume no literal.
 * @param config Overrides deployment lists; defaults to the known deployment.
 * @returns One input per context, including unused placeholders for absent slots.
 * @throws When literals have the wrong count, a list is unknown, or generation fails.
 * @example
 * const [proof] = await resolveComplianceProofs(client, undefined, [ammProofContext(address)])
 */
export async function resolveComplianceProofs<const C extends readonly (ProofContext | undefined)[]>(
  client: Client,
  source: ComplianceProofs<readonly string[]> | undefined,
  contexts: C,
  config: FreezelistConfig = {},
): Promise<{ [K in keyof C]: FreezelistProofInput }> {
  const count = contexts.filter(Boolean).length
  if (typeof source === 'string' || (Array.isArray(source) && source.every(value => typeof value === 'string'))) {
    const literals = typeof source === 'string' ? [source] : source
    if (literals.length !== count) throw new Error(`This action route requires ${count} proof bundles; received ${literals.length}`)
    let index = 0
    return contexts.map(context => context ? literals[index++]! : placeholder) as { [K in keyof C]: FreezelistProofInput }
  }
  const provider = typeof source === 'function' ? proofProviderForAccount(source, client.account?.type ?? '') : undefined
  // A single in-flight root read per list keeps all subjects on the same root.
  const roots = new Map<string, Promise<string>>()
  let cache = caches.get(client)
  if (!cache) { cache = new Map(); caches.set(client, cache) }
  return Promise.all(contexts.map(async context => {
    if (!context) return placeholder
    if (provider) return resolveProofInput(provider, context)
    const list = listFor(context, config)
    if (list === null) return placeholder
    if (Array.isArray(source)) {
      const supplied = source.find(value => value.freezelistProgram === list && value.address === context.subject)
      if (!supplied) throw new Error(`Missing proof for ${context.subject} on ${list}`)
      return supplied.proof
    }
    if (client.account?.type !== 'local') {
      return freezelistProofRequest({ freezelistProgram: list, ...(context.subjectIsSigner ? {} : { address: context.subject }) })
    }
    const generate = client.proving?.generateFreezelistProof
    if (!generate) throw new Error('Automatic freezelist proofs require an Aleo SDK proving config; supply proofs or configure generateFreezelistProof')
    let rootRequest = roots.get(list)
    if (!rootRequest) {
      rootRequest = client.request({ method: 'getMappingValue', params: { programId: list, mapping: 'freeze_list_root', key: '1u8' } }).then(value => {
        if (typeof value !== 'string' || !/^\d+field$/.test(value)) throw new Error(`Invalid current freezelist root for ${list}`)
        return value
      })
      roots.set(list, rootRequest)
    }
    const root = await rootRequest
    const key = `${client.transport.config.network ?? ''}:${list}`
    let entry = cache!.get(key)
    if (!entry || entry.root !== root) {
      entry = { root, tree: root === EMPTY_ROOT ? Promise.resolve([]) : getComplianceFreezeList(client, { programId: list }), proofs: new Map() }
      if (cache!.size >= 16) cache!.delete(cache!.keys().next().value!)
      cache!.set(key, entry)
    }
    let proof = entry.proofs.get(context.subject)
    if (!proof) {
      const current = entry
      proof = entry.tree.then(tree => generate({ address: context.subject, tree, root })).catch(error => {
        // A failed indexer snapshot must be fetched again on the next attempt.
        if (cache!.get(key) === current) cache!.delete(key)
        throw error
      })
      if (entry.proofs.size >= 256) entry.proofs.delete(entry.proofs.keys().next().value!)
      entry.proofs.set(context.subject, proof)
    }
    return proof
  })) as Promise<{ [K in keyof C]: FreezelistProofInput }>
}
