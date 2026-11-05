import { parsePlaintextValue, readContract, type Client } from '@provablehq/veil-core'
import { decodeFunctionResult, encodeFunctionData, getAddress, isAddress, hexToBytes, type Address } from 'viem'
import { resolveTransferRoute } from '../../actions/internal/resolveTransferRoute.js'
import { requireAleoClient, requireEvmClient, type BridgeChainClients } from '../../connections/resolve.js'
import type { EvmPublicClient } from '../../connections/evm.js'
import { BridgeError } from '../../errors/bridgeErrors.js'
import type { BridgePlan, BridgeRegistry } from '../../types/protocol.js'
import { ABI } from './abi.js'

/** Bounds all public ALEO amounts and packet sequence/height values to u64. */
export const U64_MAX = (1n << 64n) - 1n
/** Identifies the sentinel used to pad Aleo attestor arrays. */
export const ZERO_ALEO = 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc'

/** Resolves canonical public ALEO deployments before reading or submitting. */
export function context(registry: BridgeRegistry, clients: BridgeChainClients, plan: BridgePlan) {
  const resolved = resolveTransferRoute(registry, plan)
  const { route, sourceChain, destinationChain, sourceAsset, destinationAsset } = resolved
  if (route.protocol !== 'verulink' || route.availability !== 'active') throw new BridgeError('Verulink route requires active reviewed metadata')
  const outbound = sourceChain.family === 'aleo'
  if ((outbound ? destinationChain.family : sourceChain.family) !== 'evm'
    || (outbound ? sourceChain.family : destinationChain.family) !== 'aleo'
    || sourceAsset.decimals !== 6 || destinationAsset.decimals !== 6
    || plan.mintMode !== 'public' || plan.privateRecipient) throw new BridgeError('Verulink supports only public ALEO between Aleo and EVM')
  const string = (name: string) => {
    const value = route.metadata?.[name]
    if (typeof value !== 'string' || !value) throw new BridgeError(`Missing Verulink metadata: ${name}`)
    return value
  }
  const address = (name: string): Address => {
    const value = string(name)
    if (!isAddress(value, { strict: false })) throw new BridgeError(`Invalid Verulink address: ${name}`)
    return getAddress(value)
  }
  const domain = (name: string) => {
    const value = string(name)
    if (!/^\d+$/.test(value) || BigInt(value) <= 0n || BigInt(value) >= 1n << 128n) throw new BridgeError(`Invalid Verulink domain: ${name}`)
    return value
  }
  const evmChainId = route.metadata?.evmChainId
  const confirmations = route.metadata?.sourceConfirmations
  if (typeof evmChainId !== 'number' || !Number.isSafeInteger(evmChainId) || evmChainId <= 0
    || typeof confirmations !== 'number' || !Number.isSafeInteger(confirmations) || confirmations < 1) throw new BridgeError('Invalid Verulink chain id or confirmation policy')
  const aleoChain = outbound ? sourceChain : destinationChain
  const evmChain = outbound ? destinationChain : sourceChain
  const evmToken = address('evmToken')
  if ((outbound ? sourceAsset : destinationAsset).locator?.value !== 'credits.aleo'
    || (outbound ? destinationAsset : sourceAsset).locator?.value.toLowerCase() !== evmToken.toLowerCase()) throw new BridgeError('Verulink asset does not match the reviewed token')
  if (plan.recipient === ZERO_ALEO || plan.recipient.toLowerCase() === `0x${'0'.repeat(40)}`) throw new BridgeError('Verulink recipient cannot be zero')
  const aleoDomain = domain('aleoDomain'), evmDomain = domain('evmDomain')
  for (const [chain, expected] of [[aleoChain, aleoDomain], [evmChain, evmDomain]] as const) {
    if (chain.protocolDomains?.verulink !== undefined && String(chain.protocolDomains.verulink) !== expected) throw new BridgeError('Verulink route domain does not match chain metadata')
  }
  const aleoTokenService = string('aleoTokenService'), aleoBridge = string('aleoBridge')
  if (![aleoTokenService, aleoBridge].every(x => /^[a-zA-Z][a-zA-Z0-9_]*\.aleo$/.test(x))) throw new BridgeError('Invalid Verulink Aleo program')
  const aleoServiceAddress = string('aleoServiceAddress'), aleoTokenId = string('aleoTokenId')
  if (!/^aleo1[0-9a-z]{58}$/.test(aleoServiceAddress) || !/^\d+field$/.test(aleoTokenId)) throw new BridgeError('Invalid Verulink Aleo service or token id')
  return { ...resolved, outbound, aleoChain, evmChain,
    aleo: requireAleoClient(registry, clients, aleoChain.id), evm: requireEvmClient(registry, clients, evmChain.id),
    evmChainId, confirmations, evmDomain, aleoDomain, evmToken,
    evmTokenService: address('evmTokenService'), evmBridge: address('evmBridge'),
    aleoTokenService, aleoBridge, aleoServiceAddress, aleoTokenId, collectorUrl: string('collectorUrl'),
    chainToken: `{ chain_id: ${evmDomain}u128, token_id: ${aleoTokenId} }`,
  }
}

/** Represents resolved reviewed metadata and injected chain clients. */
export type Context = ReturnType<typeof context>

/** Reads one ABI function through the injected EVM transport. */
export async function evmRead(client: EvmPublicClient, to: Address, functionName: string, args: readonly unknown[] = []): Promise<unknown> {
  const data = await client.call({ to, data: encodeFunctionData({ abi: ABI, functionName, args } as never) })
  return decodeFunctionResult({ abi: ABI, functionName, data } as never)
}

/** Reads and parses one Aleo mapping without inferring values for absent entries. */
export async function mapping(client: Client, programId: string, name: string, key: string): Promise<unknown> {
  const literal = await readContract(client, { programId, mapping: name, key })
  return literal == null ? null : parsePlaintextValue(literal)
}

/** Converts a verified EVM address into the Aleo ABI byte-array literal. */
export function addressLiteral(value: string, padded = false): string {
  if (!isAddress(value, { strict: false })) throw new BridgeError('Invalid Verulink EVM address')
  return `[${[...(padded ? Array<number>(12).fill(0) : []), ...hexToBytes(value as Address)].map(x => `${x}u8`).join(', ')}]`
}

/** Decodes a padded onchain Aleo EVM address and rejects nonzero leading bytes. */
export function fromAleoBytes(value: unknown): Address {
  if (!Array.isArray(value) || ![20, 32].includes(value.length)
    || !value.every(x => typeof x === 'bigint' && x >= 0n && x <= 255n)
    || value.slice(0, -20).some(x => x !== 0n)) throw new BridgeError('Invalid Verulink address bytes')
  return getAddress(`0x${value.slice(-20).map(x => x.toString(16).padStart(2, '0')).join('')}`)
}

/** Requires an unsigned integer with an explicit upper bound. */
export function integer(value: unknown, name: string, max = U64_MAX): bigint {
  if (typeof value !== 'bigint' || value < 0n || value > max) throw new BridgeError(`Invalid Verulink ${name}`)
  return value
}

/** Refuses a transport connected to a different EIP-155 chain. */
export async function checkChain(c: Context): Promise<void> {
  if (await c.evm.publicClient.getChainId() !== c.evmChainId) throw new BridgeError(`Verulink requires EVM chain ${c.evmChainId}`)
}
