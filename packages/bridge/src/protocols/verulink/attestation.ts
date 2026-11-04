import { encodePacked, keccak256, recoverMessageAddress, type Hex } from 'viem'
import { BridgeError } from '../../errors/bridgeErrors.js'
import type { XReserveHttpTransport } from '../../types/xreserve.js'
import { addressLiteral, evmRead, integer, mapping, ZERO_ALEO, type Context } from './common.js'
import { decimal, object, packetHash, same, samePacket, type Packet } from './packets.js'

/** Carries a collector signature and the identity that must verify it. */
export type AttestorSignature = { signer: string; sign: string }

function collectorPacket(value: unknown): Packet {
  const p = object(value), m = object(p.message)
  return { version: decimal(p.version), sequence: decimal(p.sequence), height: decimal(p.height),
    sourceChain: decimal(p.sourceChain, (1n << 128n) - 1n), destinationChain: decimal(p.destinationChain, (1n << 128n) - 1n),
    sourceAddress: String(p.sourceAddress), destinationAddress: String(p.destinationAddress), sender: String(m.sender),
    recipient: String(m.receiver), token: String(m.denom), amount: decimal(m.amount) }
}

/** Retrieves only the exact source-verified packet, with bounded and checked pagination. */
export async function fetchSignatures(c: Context, fetcher: XReserveHttpTransport, packet: Packet, signal?: AbortSignal): Promise<AttestorSignature[]> {
  const base = new URL(c.collectorUrl)
  if (base.protocol !== 'https:' || base.username || base.password) throw new BridgeError('Verulink collector requires an HTTPS URL without credentials')
  for (let page = 1; page <= 100; page++) {
    signal?.throwIfAborted()
    const url = `${c.collectorUrl.replace(/\/$/, '')}/packet/wallet/${encodeURIComponent(packet.sender)}?page=${page}`
    const response = await fetcher(url, signal ? { signal } : undefined)
    if (!response.ok) throw new BridgeError(`Verulink signature collector returned HTTP ${response.status}`)
    const body = object(object(await response.json()).data)
    if (!Array.isArray(body.data) || !Number.isSafeInteger(body.currentPage) || body.currentPage !== page
      || !Number.isSafeInteger(body.totalPages) || Number(body.totalPages) < 0 || body.data.length > 1000) throw new BridgeError('Invalid Verulink collector pagination')
    for (const value of body.data) {
      const row = object(value)
      if (String(row.sourceChain) !== packet.sourceChain || String(row.destinationChain) !== packet.destinationChain
        || decimal(row.sequence) !== packet.sequence) continue
      if (!samePacket(packet, collectorPacket(row))) throw new BridgeError('Verulink collector packet does not match confirmed source data')
      const status = object(row.status)
      if (!Array.isArray(status.signatures) || status.signatures.length > 100) throw new BridgeError('Invalid Verulink signature list')
      return status.signatures.map(value => {
        const signature = object(value)
        if (typeof signature.signer !== 'string' || typeof signature.sign !== 'string') throw new BridgeError('Invalid Verulink attestor signature')
        return { signer: signature.signer, sign: signature.sign }
      })
    }
    if (page >= Number(body.totalPages)) return []
  }
  throw new BridgeError('Verulink collector history exceeds the 100-page lookup bound')
}

/** Reconstructs the Aleo signed InPacket literal in the deployed field order. */
export function aleoPacketLiteral(packet: Packet): string {
  return `{ version: ${packet.version}u8, sequence: ${packet.sequence}u64, source: { chain_id: ${packet.sourceChain}u128, addr: ${addressLiteral(packet.sourceAddress, true)} }, destination: { chain_id: ${packet.destinationChain}u128, addr: ${packet.destinationAddress} }, message: { sender_address: ${addressLiteral(packet.sender, true)}, dest_token_id: ${packet.token}, amount: ${packet.amount}u128, receiver_address: ${packet.recipient} }, height: ${packet.height}u64 }`
}

/** Verifies native Aleo signatures locally; the optional WASM SDK loads only for a ready Aleo claim. */
async function verifyAleo(c: Context, packet: Packet, signatures: AttestorSignature[]): Promise<boolean[]> {
  let sdk: Awaited<ReturnType<typeof import('@provablehq/sdk/dynamic.js')['loadNetwork']>>
  try { sdk = await (await import('@provablehq/sdk/dynamic.js')).loadNetwork(c.aleoChain.environment) }
  catch (cause) { throw new BridgeError('Verulink Aleo claims require the optional @provablehq/sdk package to verify signatures', { cause }) }
  const resources: { free(): void }[] = []
  const own = <T extends { free(): void }>(value: T) => { resources.push(value); return value }
  try {
    const bhp = own(new sdk.BHP256())
    const hash = own(bhp.hash(own(sdk.Plaintext.fromString(aleoPacketLiteral(packet))).toBitsLe()))
    const positive = own(bhp.hash(own(sdk.Plaintext.fromString(`{ packet_hash: ${hash.toString()}, screening_passed: true }`)).toBitsLe())).toString()
    const negative = own(bhp.hash(own(sdk.Plaintext.fromString(`{ packet_hash: ${hash.toString()}, screening_passed: false }`)).toBitsLe())).toString()
    return signatures.map(value => {
      const address = own(sdk.Address.from_string(value.signer)), signature = own(sdk.Signature.from_string(value.sign))
      if (signature.verifyValue(address, positive)) return true
      if (signature.verifyValue(address, negative)) return false
      throw new BridgeError('Invalid Verulink Aleo attestor signature')
    })
  } finally { resources.reverse().forEach(value => value.free()) }
}

/** Checks current membership and cryptographic signatures, retaining only a positive quorum. */
export async function verifiedSignatures(c: Context, packet: Packet, signatures: AttestorSignature[]): Promise<AttestorSignature[] | null> {
  const threshold = integer(c.outbound
    ? await evmRead(c.evm.publicClient, c.evmBridge, 'quorumRequired')
    : await mapping(c.aleo.publicClient, c.aleoBridge, 'bridge_settings', '1u8'), 'attestor quorum', c.outbound ? 100n : 5n)
  if (threshold < 1n) throw new BridgeError('Verulink attestor quorum cannot be zero')
  if (signatures.length < Number(threshold)) return null
  if (!c.outbound && signatures.length > 5) throw new BridgeError('Verulink Aleo attestor array exceeds five signers')
  const seen = new Set<string>()
  for (const value of signatures) {
    const id = c.outbound ? value.signer.toLowerCase() : value.signer
    if (seen.has(id) || value.signer === ZERO_ALEO) throw new BridgeError('Duplicate or zero Verulink attestor')
    seen.add(id)
    if (c.outbound) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(value.signer) || !/^0x[0-9a-fA-F]{130}$/.test(value.sign)) throw new BridgeError('Invalid EVM attestor signature encoding')
      if (await evmRead(c.evm.publicClient, c.evmBridge, 'isAttestor', [value.signer]) !== true) throw new BridgeError('Unknown Verulink EVM attestor')
    } else {
      if (!/^aleo1[0-9a-z]{58}$/.test(value.signer) || !/^sign1[0-9a-z]+$/.test(value.sign)) throw new BridgeError('Invalid Aleo attestor signature encoding')
      // The deployed program tests membership with contains, not the stored boolean.
      if (await mapping(c.aleo.publicClient, c.aleoBridge, 'attestors', value.signer) === null) throw new BridgeError('Unknown Verulink Aleo attestor')
    }
  }
  const votes = c.outbound ? await Promise.all(signatures.map(async value => {
    const hash = packetHash(packet)
    for (const vote of [1, 2] as const) {
      const recovered = await recoverMessageAddress({ message: { raw: keccak256(encodePacked(['bytes32', 'uint8'], [hash, vote])) }, signature: value.sign as Hex })
      if (same(recovered, value.signer)) return vote === 1
    }
    throw new BridgeError('Invalid Verulink EVM attestor signature')
  })) : await verifyAleo(c, packet, signatures)
  const positive = signatures.filter((_value, index) => votes[index])
  if (signatures.length - positive.length >= Number(threshold)) throw new BridgeError('Verulink attestors screened this packet negatively; public delivery is unavailable')
  if (positive.length < Number(threshold)) return null
  return positive.sort((a, b) => a.signer.toLowerCase().localeCompare(b.signer.toLowerCase()))
}
