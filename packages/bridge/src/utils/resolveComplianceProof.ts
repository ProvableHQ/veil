import { freezelistProofRequest, type FreezelistProofInput } from '@provablehq/veil-core'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { AleoWalletClient } from '../types/aleo.js'
import type { ComplianceProofs, MerkleProofInput } from '../types/compliance.js'
import type { ProtocolBridgeAsset } from '../types/protocol.js'
import { bridgeFreezelistProgram, validateBridgeFreezelistProof } from './freezelist.js'

const EMPTY_ROOT = '3642222252059314292809609689035560016959342421640560347114299934615987159853field'
type CachedTree = { root: string; tree: Promise<string[]>; proofs: Map<string, Promise<string>> }
const caches = new WeakMap<AleoWalletClient, Map<string, CachedTree>>()

/**
 * Extracts a literal bundle or wallet request without invoking a provider or reading a chain.
 * @param source Supplies the action's proof input; automatic and annotated inputs return undefined.
 * @returns A single concrete input, or undefined when client-based resolution is required.
 * @throws BridgeError When a positional array does not contain exactly one string.
 * @example const literal = literalComplianceProof(['[...]'])
 */
export function literalComplianceProof(source: ComplianceProofs | undefined): FreezelistProofInput | undefined {
  if (typeof source === 'string') return source
  if (Array.isArray(source) && source.every(value => typeof value === 'string')) {
    if (source.length !== 1) throw new BridgeError('This operation requires exactly one compliance proof bundle')
    return source[0]
  }
  if (source && typeof source === 'object' && !Array.isArray(source)) return source as FreezelistProofInput
  return undefined
}

function formatPair(pair: readonly [MerkleProofInput, MerkleProofInput]): string {
  if (pair.length !== 2) throw new BridgeError('A compliance proof bundle requires two Merkle paths')
  return `[${pair.map(path => {
    if (path.siblings.length !== 16) throw new BridgeError('A compliance Merkle path requires 16 siblings')
    return `{ siblings: [${path.siblings.join(', ')}], leaf_index: ${path.leaf_index}u32 }`
  }).join(', ')}]`
}

/**
 * Resolves a signer's compliance proof for an ARC-22 unshield or private burn.
 *
 * Local accounts read the current root and reuse verified witnesses while it is
 * unchanged. The per-client cache holds at most 16 lists and 256 subjects per list.
 * Wallets receive signer-only derived requests and own generation and caching.
 * @param client Supplies execution, optional signer metadata, and local proving capabilities.
 * @param asset Supplies the reviewed freezelist and chain identifier.
 * @param source Supplies a bundle or provider; null and omission enable automatic resolution.
 * @returns One encoded bundle or wallet request without signing or submitting a transaction.
 * @throws BridgeError When inputs, metadata, or local generation capabilities are missing or invalid.
 * @example const proof = await resolveComplianceProof(walletClient, asset)
 */
export async function resolveComplianceProof(
  client: AleoWalletClient,
  asset: ProtocolBridgeAsset,
  source?: ComplianceProofs,
): Promise<FreezelistProofInput> {
  const checked = (value: unknown): FreezelistProofInput => {
    const proof = validateBridgeFreezelistProof(value, asset)
    if (client.account?.type === 'local' && typeof proof !== 'string') {
      throw new BridgeError('Local accounts cannot resolve wallet-derived compliance proofs; supply a literal or use automatic generation')
    }
    return proof
  }
  const literal = literalComplianceProof(source)
  if (literal !== undefined) return checked(literal)
  const freezelistProgram = bridgeFreezelistProgram(asset)
  const address = client.account?.address
  if (typeof source === 'function' || Array.isArray(source)) {
    if (!address) throw new BridgeError('Aleo account address is required for a compliance provider or annotated proofs')
    if (typeof source === 'function') {
      const value = await source({ freezelistProgram, address })
      return checked(Array.isArray(value) ? formatPair(value as readonly [MerkleProofInput, MerkleProofInput]) : value)
    }
    const supplied = source.find(value => value?.freezelistProgram === freezelistProgram && value.address === address)
    if (!supplied) throw new BridgeError(`Missing proof for ${address} on ${freezelistProgram}`)
    return checked(supplied.proof)
  }
  if (client.account?.type !== 'local') return freezelistProofRequest({ freezelistProgram })
  const generate = client.proving?.generateFreezelistProof
  const request = client.request
  if (!generate || !request || !address) {
    throw new BridgeError('Automatic compliance proofs require an Aleo SDK client with a signer, transport, and generateFreezelistProof')
  }
  const root = await request({ method: 'getMappingValue', params: { programId: freezelistProgram, mapping: 'freeze_list_root', key: '1u8' } })
  if (typeof root !== 'string' || !/^\d+field$/.test(root)) throw new BridgeError(`Invalid current freezelist root for ${freezelistProgram}`)
  let cache = caches.get(client)
  if (!cache) { cache = new Map(); caches.set(client, cache) }
  const key = `${asset.chainId}:${client.transport?.config.network ?? ''}:${freezelistProgram}`
  let entry = cache.get(key)
  if (!entry || entry.root !== root) {
    const tree = root === EMPTY_ROOT ? Promise.resolve([]) : request({ method: 'getComplianceFreezeList', params: { programId: freezelistProgram } }).then(value => {
      if (!Array.isArray(value) || !value.every(node => typeof node === 'string' && /^\d+$/.test(node))) {
        throw new BridgeError('Invalid compliance tree: expected decimal field strings')
      }
      return value as string[]
    })
    entry = { root, tree, proofs: new Map() }
    if (cache.size >= 16) cache.delete(cache.keys().next().value!)
    cache.set(key, entry)
  }
  let proof = entry.proofs.get(address)
  if (!proof) {
    const current = entry
    proof = entry.tree.then(tree => generate({ address, tree, root })).catch(error => {
      // Retry failed indexer snapshots or witness generation on the next call.
      if (cache!.get(key) === current) cache!.delete(key)
      throw error
    })
    if (entry.proofs.size >= 256) entry.proofs.delete(entry.proofs.keys().next().value!)
    entry.proofs.set(address, proof)
  }
  return proof
}
