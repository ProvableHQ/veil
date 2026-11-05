import { parsePlaintextValue, transactionStatus, type Transaction, type Transition } from '@provablehq/veil-core'
import { decodeEventLog, decodeFunctionData, encodePacked, getAddress, isHash, keccak256, type Address } from 'viem'
import { BridgeError } from '../../errors/bridgeErrors.js'
import type { BridgePlan } from '../../types/protocol.js'
import { parseDecimalAmount } from '../../utils/units.js'
import { ABI } from './abi.js'
import { checkChain, fromAleoBytes, integer, mapping, U64_MAX, type Context } from './common.js'

/** Retains canonical packet values as lossless, JSON-safe strings. */
export type Packet = {
  version: string; sequence: string; sourceChain: string; destinationChain: string
  sourceAddress: string; destinationAddress: string; sender: string; recipient: string
  token: string; amount: string; height: string
}

/** Requires an object before interpreting untrusted protocol data. */
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BridgeError('Invalid Verulink object')
  return value as Record<string, unknown>
}

/** Converts a wire integer without accepting imprecise JSON numbers. */
export function decimal(value: unknown, max = U64_MAX): string {
  if ((typeof value !== 'string' || !/^\d+$/.test(value))
    && (typeof value !== 'bigint')
    && (typeof value !== 'number' || !Number.isSafeInteger(value))) throw new BridgeError('Invalid Verulink integer encoding')
  const number = BigInt(value as string | bigint | number)
  if (number < 0n || number > max) throw new BridgeError('Verulink integer exceeds its onchain width')
  return number.toString()
}

/** Compares chain addresses case-insensitively only for EVM values. */
export function same(a: unknown, b: unknown): boolean {
  return typeof a === 'string' && typeof b === 'string'
    && (a.startsWith('0x') && b.startsWith('0x') ? a.toLowerCase() === b.toLowerCase() : a === b)
}

/** Compares every signed packet field, excluding collector status and identifiers. */
export function samePacket(a: Packet, b: Packet): boolean {
  return (Object.keys(a) as (keyof Packet)[]).every(key => same(a[key], b[key]))
}

/** Decodes a confirmed Aleo out_packets mapping entry. */
function aleoPacket(value: unknown): Packet {
  const packet = object(value), source = object(packet.source), destination = object(packet.destination), message = object(packet.message)
  return { version: decimal(packet.version), sequence: decimal(packet.sequence), sourceChain: decimal(source.chain_id, (1n << 128n) - 1n),
    destinationChain: decimal(destination.chain_id, (1n << 128n) - 1n), sourceAddress: String(source.addr), destinationAddress: fromAleoBytes(destination.addr),
    sender: String(message.sender_address), recipient: fromAleoBytes(message.receiver_address), token: fromAleoBytes(message.dest_token_address),
    amount: decimal(message.amount), height: decimal(packet.height) }
}

/** Decodes the EVM event packet without relying on collector indexing. */
export function evmPacket(value: unknown): Packet {
  const packet = object(value), source = object(packet.sourceTokenService), destination = object(packet.destTokenService), message = object(packet.message)
  return { version: decimal(packet.version), sequence: decimal(packet.sequence), sourceChain: decimal(source.chainId, (1n << 128n) - 1n),
    destinationChain: decimal(destination.chainId, (1n << 128n) - 1n), sourceAddress: String(source.addr), destinationAddress: String(destination.addr),
    sender: String(message.senderAddress), recipient: String(message.receiverAddress), token: String(message.destTokenAddress),
    amount: decimal(message.amount), height: decimal(packet.height) }
}

/** Validates route, recipient, sender, token, version, and bounded net output. */
export function validatePacket(c: Context, plan: BridgePlan, packet: Packet): void {
  if (packet.version !== '1' || BigInt(packet.sequence) < 1n
    || packet.sourceChain !== (c.outbound ? c.aleoDomain : c.evmDomain)
    || packet.destinationChain !== (c.outbound ? c.evmDomain : c.aleoDomain)
    || !same(packet.sourceAddress, c.outbound ? c.aleoServiceAddress : c.evmTokenService)
    || !same(packet.destinationAddress, c.outbound ? c.evmTokenService : c.aleoServiceAddress)
    || !same(packet.token, c.outbound ? c.evmToken : c.aleoTokenId)
    || !same(packet.recipient, plan.recipient) || (plan.sender !== undefined && !same(packet.sender, plan.sender))
    || BigInt(packet.amount) <= 0n || BigInt(packet.amount) > parseDecimalAmount(plan.amountIn, 6)) throw new BridgeError('Verulink source packet does not match the transfer')
}

/** Selects exactly one public service transition; ambiguous calls cannot be recovered automatically. */
export function transition(transaction: Transaction, program: string, name: string): Transition {
  const calls = transaction.execution?.transitions.filter(x => x.program === program && x.function === name) ?? []
  if (calls.length !== 1) throw new BridgeError(`Verulink transaction requires exactly one ${program}/${name} transition`)
  return calls[0]!
}

/** Reads public transition inputs and refuses hidden or missing values. */
export function inputs(call: Transition): unknown[] {
  return (call.inputs ?? []).map(x => {
    if (x.type !== 'public' || x.value === undefined) throw new BridgeError('Verulink transition has missing public inputs')
    return parsePlaintextValue(x.value)
  })
}

/** Reads an accepted transaction body only after checking the ledger outcome. */
export async function aleoTransaction(c: Context, id: string): Promise<Transaction | 'pending' | 'rejected'> {
  const status = await transactionStatus(c.aleo.publicClient, { transactionId: id })
  if (status.status === 'rejected') return 'rejected'
  if (status.status !== 'accepted') return 'pending'
  const confirmed = object(await c.aleo.publicClient.request({ method: 'getConfirmedTransaction', params: { id } }))
  const transaction = object(confirmed.transaction)
  if (confirmed.status !== 'accepted' || transaction.id !== id) throw new BridgeError('Verulink Aleo transaction identity mismatch')
  return transaction as unknown as Transaction
}

/** Validates a prepared or accepted public source call against its transfer plan. */
export function validateAleoSource(c: Context, plan: BridgePlan, tx: Transaction): { amount: bigint; sender: string } {
  const root = tx.execution?.transitions.at(-1)
  if (root?.program !== c.aleoTokenService || root.function !== 'token_send_public') throw new BridgeError('Verulink source root call does not match the transfer')
  const call = inputs(transition(tx, c.aleoTokenService, 'token_send_public'))
  if (call.length !== 6 || !same(fromAleoBytes(call[0]), plan.recipient)
    || call[1] !== parseDecimalAmount(plan.amountIn, 6) || call[2] !== BigInt(c.evmDomain)
    || fromAleoBytes(call[3]) !== c.evmTokenService || fromAleoBytes(call[4]) !== c.evmToken) throw new BridgeError('Verulink Aleo source inputs do not match the transfer')
  const fee = integer(call[5], 'submitted fee'), amount = integer(call[1], 'submitted amount') - fee
  const published = inputs(transition(tx, c.aleoBridge, 'publish'))
  if (published.length !== 7 || published[0] !== 1n || published[1] !== BigInt(c.evmDomain)
    || fromAleoBytes(published[2]) !== c.evmTokenService || fromAleoBytes(published[3]) !== c.evmToken
    || fromAleoBytes(published[5]) !== getAddress(plan.recipient) || published[6] !== amount
    || typeof published[4] !== 'string' || (plan.sender && published[4] !== plan.sender)) throw new BridgeError('Verulink published packet does not match the source inputs')
  if (amount <= 0n) throw new BridgeError('Verulink source net amount must be positive')
  if (plan.amountOut !== undefined && amount < parseDecimalAmount(plan.amountOut, 6)) throw new BridgeError('Verulink prepared source fee exceeds the quoted fee')
  return { amount, sender: published[4] as string }
}

/** Validates a prepared or accepted destination call against every source packet field. */
export function validateAleoClaim(c: Context, packet: Packet, tx: Transaction): Transition {
  const root = tx.execution?.transitions.at(-1)
  if (root?.program !== c.aleoTokenService || root.function !== 'token_receive_public') throw new BridgeError('Verulink claim root call does not match the packet')
  const claim = transition(tx, c.aleoTokenService, 'token_receive_public')
  const values = inputs(claim)
  if (values.length !== 9 || !same(fromAleoBytes(values[0]), packet.sender) || values[1] !== packet.recipient
    || values[2] !== BigInt(packet.amount) || values[3] !== BigInt(packet.sequence) || values[4] !== BigInt(packet.height)
    || values[7] !== BigInt(packet.sourceChain) || !same(fromAleoBytes(values[8]), packet.sourceAddress)) throw new BridgeError('Verulink Aleo claim does not match the source packet')
  return claim
}

/** Reconstructs the packet from the submitted source transaction and immutable chain evidence. */
export async function sourcePacket(c: Context, plan: BridgePlan, id: string): Promise<Packet | 'pending' | 'rejected'> {
  await checkChain(c)
  if (!c.outbound) {
    if (!isHash(id)) throw new BridgeError('Invalid Verulink EVM source transaction id')
    const result = await c.evm.publicClient.getTransactionReceipt(id)
    if (!result) return 'pending'
    if (result.status === 'reverted') return 'rejected'
    if (!same(result.transactionHash, id) || result.blockNumber === undefined) throw new BridgeError('Verulink source receipt identity mismatch')
    if (!c.evm.publicClient.getBlockNumber) throw new BridgeError('Verulink requires EVM block-height reads to verify source finality')
    if (await c.evm.publicClient.getBlockNumber() < result.blockNumber + BigInt(c.confirmations - 1)) return 'pending'
    const tx = await c.evm.publicClient.getTransaction(id)
    if (!tx || !same(tx.hash, id) || !same(tx.to, c.evmTokenService) || tx.blockNumber !== result.blockNumber) throw new BridgeError('Verulink source transaction does not match its receipt')
    const decoded = decodeFunctionData({ abi: ABI, data: tx.input })
    if (decoded.functionName !== 'publicTokenSend' || !same(decoded.args?.[0], c.evmToken)
      || decoded.args?.[1] !== parseDecimalAmount(plan.amountIn, 6) || decoded.args?.[2] !== plan.recipient
      || (plan.sender && !same(tx.from, plan.sender))) throw new BridgeError('Verulink source calldata does not match the transfer')
    const packets: Packet[] = []
    for (const log of result.logs) {
      if (!same(log.address, c.evmBridge)) continue
      try {
        const event = decodeEventLog({ abi: ABI, eventName: 'PacketDispatched', data: log.data, topics: log.topics as never })
        packets.push(evmPacket(event.args.packet))
      } catch (error) { if (error instanceof BridgeError) throw error }
    }
    if (packets.length !== 1) throw new BridgeError('Verulink source receipt is missing its unique PacketDispatched event')
    const packet = packets[0]!
    validatePacket(c, plan, packet)
    if (!same(packet.sender, tx.from) || packet.height !== result.blockNumber.toString()) throw new BridgeError('Verulink packet does not match its source transaction')
    return packet
  }
  const tx = await aleoTransaction(c, id)
  if (typeof tx === 'string') return tx
  const { amount, sender } = validateAleoSource(c, plan, tx)
  const hash = await c.aleo.publicClient.request({ method: 'findBlockHash', params: { transactionId: id } })
  const height = decimal(await c.aleo.publicClient.request({ method: 'getBlockHeightByHash', params: { hash } }))
  // sequences stores the NEXT sequence. Binary search immutable packets by block height.
  const next = integer(await mapping(c.aleo.publicClient, c.aleoBridge, 'sequences', `${c.evmDomain}u128`), 'next sequence')
  const read = async (sequence: bigint) => aleoPacket(await mapping(c.aleo.publicClient, c.aleoBridge, 'out_packets', `{ chain_id: ${c.evmDomain}u128, sequence: ${sequence}u64 }`))
  let low = 1n, high = next
  while (low < high) {
    const middle = (low + high) / 2n
    if (BigInt((await read(middle)).height) < BigInt(height)) low = middle + 1n
    else high = middle
  }
  const matches: Packet[] = []
  for (let sequence = low, count = 0; sequence < next; sequence++, count++) {
    if (count >= 128) throw new BridgeError('Verulink source block packet scan exceeds its bound')
    const packet = await read(sequence)
    if (packet.height !== height) break
    if (same(packet.sender, sender) && same(packet.recipient, plan.recipient)
      && packet.amount === amount.toString() && same(packet.sourceAddress, c.aleoServiceAddress)
      && same(packet.destinationAddress, c.evmTokenService) && same(packet.token, c.evmToken)) matches.push(packet)
  }
  if (matches.length !== 1) throw new BridgeError(matches.length ? 'Ambiguous Verulink packets in the Aleo source block' : 'Verulink source packet does not match the confirmed transaction')
  validatePacket(c, plan, matches[0]!)
  return matches[0]!
}

/** Builds the Solidity incoming packet tuple from verified source values. */
export function incoming(packet: Packet) {
  return { version: BigInt(packet.version), sequence: BigInt(packet.sequence),
    sourceTokenService: { chainId: BigInt(packet.sourceChain), addr: packet.sourceAddress },
    destTokenService: { chainId: BigInt(packet.destinationChain), addr: getAddress(packet.destinationAddress) },
    message: { senderAddress: packet.sender, destTokenAddress: getAddress(packet.token), amount: BigInt(packet.amount), receiverAddress: getAddress(packet.recipient) },
    height: BigInt(packet.height) }
}

/** Reproduces PacketLibrary.hash for an Aleo-to-EVM packet. */
export function packetHash(packet: Packet) {
  return keccak256(encodePacked(['uint256', 'uint256', 'uint256', 'string', 'uint256', 'address', 'string', 'address', 'uint256', 'address', 'uint256'],
    [BigInt(packet.version), BigInt(packet.sequence), BigInt(packet.sourceChain), packet.sourceAddress, BigInt(packet.destinationChain), packet.destinationAddress as Address,
      packet.sender, packet.token as Address, BigInt(packet.amount), packet.recipient as Address, BigInt(packet.height)]))
}
