import { decodeEventLog, decodeFunctionData, encodeFunctionData, isHash, zeroAddress, zeroHash, type Hex } from 'viem'
import { classifyBroadcastError, DuplicateTransactionError, type Transaction } from '@provablehq/veil-core'
import { createBridgeCheckpoint } from '../../actions/createBridgeCheckpoint.js'
import { requireAleoClientWithWallet, requireEvmClientWithWallet, type BridgeChainClients } from '../../connections/resolve.js'
import { BridgeError } from '../../errors/bridgeErrors.js'
import type { CompleteParameters, GetStatusParameters } from '../../types/actions.js'
import type { BridgeCheckpoint, BridgePlan, BridgeReceipt, BridgeRegistry } from '../../types/protocol.js'
import type { VerulinkExecution } from '../../types/verulink.js'
import type { XReserveHttpTransport } from '../../types/xreserve.js'
import { parseDecimalAmount } from '../../utils/units.js'
import { ABI } from './abi.js'
import { addressLiteral, context, evmRead, fromAleoBytes, mapping, ZERO_ALEO, type Context } from './common.js'
import { aleoTransaction, evmPacket, incoming, inputs, packetHash, same, samePacket, sourcePacket, validateAleoSource, validateAleoClaim, transition, type Packet } from './packets.js'
import { fetchSignatures, verifiedSignatures, type AttestorSignature } from './attestation.js'
import { assertActive, configuration } from './quote.js'

function update(receipt: BridgeReceipt, status: BridgeReceipt['status'], state: Record<string, unknown> = {}): BridgeReceipt {
  const { nextAction: _nextAction, ...rest } = receipt
  return { ...rest, status, protocolState: { ...receipt.protocolState, ...state } }
}

/** Reads the destination replay guard without mistaking consumption for recipient delivery. */
export async function consumed(c: Context, packet: Packet): Promise<boolean> {
  if (c.outbound) {
    const hash = await evmRead(c.evm.publicClient, c.evmBridge, 'consumedPackets', [BigInt(packet.sequence)])
    if (hash === zeroHash) return false
    if (hash !== packetHash(packet)) throw new BridgeError('Verulink sequence was consumed with a different packet hash')
    return true
  }
  const value = await mapping(c.aleo.publicClient, c.aleoBridge, 'in_packet_consumed', `{ chain_id: ${packet.sourceChain}u128, sequence: ${packet.sequence}u64 }`)
  if (value === true) return true
  if (value === false || value === null) return false
  throw new BridgeError('Invalid Verulink consumed-packet flag')
}

async function destinationStatus(c: Context, packet: Packet, receipt: BridgeReceipt): Promise<BridgeReceipt> {
  const id = receipt.destinationTxId!
  if (c.outbound) {
    if (!isHash(id)) throw new BridgeError('Invalid Verulink EVM claim transaction id')
    const result = await c.evm.publicClient.getTransactionReceipt(id)
    if (!result) return update(receipt, 'DESTINATION_CONFIRMING')
    if (result.status === 'reverted') return update(receipt, 'FAILED', { destinationError: `Verulink claim reverted: ${id}` })
    if (result.blockNumber === undefined || !c.evm.publicClient.getBlockNumber) throw new BridgeError('Verulink requires EVM block-height reads to verify destination finality')
    if (await c.evm.publicClient.getBlockNumber() < result.blockNumber + BigInt(c.confirmations - 1)) return update(receipt, 'DESTINATION_CONFIRMING')
    const tx = await c.evm.publicClient.getTransaction(id)
    if (!tx || !same(tx.hash, id) || !same(result.transactionHash, id) || !same(tx.to, c.evmTokenService)
      || tx.blockNumber !== result.blockNumber) throw new BridgeError('Verulink claim transaction identity mismatch')
    const call = decodeFunctionData({ abi: ABI, data: tx.input })
    if (call.functionName !== 'tokenReceive' || !samePacket(packet, evmPacket(call.args[0]))) throw new BridgeError('Verulink claim calldata does not match the source packet')
    let consumeEvent = false, delivered = false, mintedElsewhere: string | undefined
    for (const log of result.logs) {
      try {
        if (same(log.address, c.evmBridge)) {
          const event = decodeEventLog({ abi: ABI, eventName: 'Consumed', data: log.data, topics: log.topics as never })
          if (event.args.chainId === BigInt(packet.sourceChain) && event.args.sequence === BigInt(packet.sequence)
            && event.args.packetHash === packetHash(packet)) consumeEvent = true
        }
        if (same(log.address, c.evmToken)) {
          const event = decodeEventLog({ abi: ABI, eventName: 'Transfer', data: log.data, topics: log.topics as never })
          if (same(event.args.from, zeroAddress) && event.args.value === BigInt(packet.amount)) {
            if (same(event.args.to, packet.recipient)) delivered = true
            else mintedElsewhere = event.args.to
          }
        }
      } catch { /* Unrelated logs are not delivery evidence. */ }
    }
    if (!consumeEvent || !await consumed(c, packet)) throw new BridgeError('Verulink claim receipt lacks the expected consumption evidence')
    if (delivered) return update(receipt, 'COMPLETED')
    if (mintedElsewhere && same(mintedElsewhere, await evmRead(c.evm.publicClient, c.evmTokenService, 'holding'))) return update(receipt, 'FAILED', { destinationError: 'Verulink screening placed the transferred ALEO in holding', held: true })
    throw new BridgeError('Verulink claim receipt does not prove recipient delivery')
  }
  const tx = await aleoTransaction(c, id)
  if (tx === 'pending') return update(receipt, 'DESTINATION_CONFIRMING')
  if (tx === 'rejected') return update(receipt, 'FAILED', { destinationError: `Verulink Aleo claim rejected: ${id}` })
  const claim = validateAleoClaim(c, packet, tx)
  if (!await consumed(c, packet)) throw new BridgeError('Accepted Verulink claim has no consumed-packet flag')
  const screening = claim.outputs?.find(output => output.type === 'public')?.value
  if (screening === 'false') return update(receipt, 'FAILED', { destinationError: 'Verulink screening placed the transferred ALEO in holding', held: true })
  if (screening !== 'true') throw new BridgeError('Verulink Aleo claim has no screening result')
  const transfer = inputs(transition(tx, 'credits.aleo', 'transfer_public'))
  if (transfer[0] !== packet.recipient || transfer[1] !== BigInt(packet.amount)) throw new BridgeError('Verulink Aleo claim does not prove recipient delivery')
  return update(receipt, 'COMPLETED')
}

/** Validates submitted approvals and reports the next explicit source boundary. */
async function approvalStatus(c: Context, plan: BridgePlan, receipt: BridgeReceipt): Promise<BridgeReceipt> {
  const ids = receipt.protocolState.approvalTxIds
  if (!Array.isArray(ids) || ids.length === 0 || ids.some(id => typeof id !== 'string' || !isHash(id))) throw new BridgeError('Invalid Verulink approval checkpoint')
  for (const id of ids as Hex[]) {
    const [result, tx] = await Promise.all([c.evm.publicClient.getTransactionReceipt(id), c.evm.publicClient.getTransaction(id)])
    if (!result || !tx) return update(receipt, 'SOURCE_APPROVAL_PENDING')
    if (result.status === 'reverted') return update(receipt, 'FAILED', { sourceError: `Verulink approval reverted: ${id}` })
    const call = decodeFunctionData({ abi: ABI, data: tx.input })
    if (!same(tx.hash, id) || !same(result.transactionHash, id) || !same(tx.to, c.evmToken)
      || !same(tx.from, plan.sender ?? receipt.protocolState.sourceSender) || call.functionName !== 'approve'
      || !same(call.args[0], c.evmTokenService) || call.args[1] !== parseDecimalAmount(plan.amountIn, 6)
      || result.blockNumber === undefined || tx.blockNumber !== result.blockNumber) throw new BridgeError('Verulink approval does not match the transfer')
  }
  return update(receipt, 'SOURCE_SUBMISSION_PENDING')
}

/** Advances only from verified source, signatures, and destination evidence; never submits. */
export async function getStatus(registry: BridgeRegistry, clients: BridgeChainClients, fetcher: XReserveHttpTransport, params: GetStatusParameters): Promise<BridgeReceipt> {
  const { plan, receipt } = params
  const c = context(registry, clients, plan)
  if (receipt.protocol !== 'verulink' || receipt.protocolState.routeId !== c.route.id) throw new BridgeError('Verulink receipt does not match the route')
  if (!receipt.sourceTxId) {
    if (!c.outbound && ['SOURCE_APPROVAL_PENDING', 'SOURCE_SUBMISSION_PENDING'].includes(receipt.status)) return approvalStatus(c, plan, receipt)
    throw new BridgeError('Verulink receipt has no source transaction')
  }
  const packet = await sourcePacket(c, plan, receipt.sourceTxId)
  if (packet === 'pending') return update(receipt, 'SOURCE_CONFIRMING')
  if (packet === 'rejected') return update(receipt, 'FAILED', { sourceError: 'Verulink source transaction was rejected' })
  const verified = update(receipt, 'ATTESTATION_PENDING', { packet, sourceSender: packet.sender })
  if (receipt.destinationTxId) return destinationStatus(c, packet, verified)
  const preparedDestination = receipt.protocolState.preparedDestinationTransaction
  if (preparedDestination !== undefined) {
    if (c.outbound || typeof preparedDestination !== 'string') throw new BridgeError('Invalid Verulink prepared destination transaction')
    const tx = preparedTransaction(preparedDestination, receipt.id)
    validateAleoClaim(c, packet, tx)
    // A broadcast may have succeeded before its checkpoint was saved. Follow
    // that exact claim on every poll, retaining its bytes until it is observed.
    if (await aleoTransaction(c, tx.id) !== 'pending') {
      return destinationStatus(c, packet, update({ ...verified, destinationTxId: tx.id }, 'DESTINATION_CONFIRMING',
        { preparedDestinationTransaction: undefined }))
    }
  }
  if (await consumed(c, packet)) return update(verified, 'DELIVERY_PENDING', { consumed: true,
    destinationVerificationRequired: 'Packet consumed; a destination transaction id is required to distinguish public delivery from holding' })
  const signatures = await verifiedSignatures(c, packet, await fetchSignatures(c, fetcher, packet, params.signal))
  if (!signatures) return verified
  return { ...verified, status: 'DESTINATION_ACTION_REQUIRED', nextAction: { kind: 'verulink-claim', chainId: c.destinationChain.id },
    protocolState: { ...verified.protocolState, signatures } }
}

function preparedTransaction(serialized: string, id: string): Transaction {
  let tx: Transaction
  try { tx = JSON.parse(serialized) as Transaction } catch (cause) { throw new BridgeError('Invalid Verulink prepared transaction', { cause }) }
  if (!tx || tx.id !== id) throw new BridgeError('Verulink prepared transaction id mismatch')
  return tx
}

/** Rebuilds Verulink progress from public transaction identifiers without signing. */
export async function recover(registry: BridgeRegistry, clients: BridgeChainClients, fetcher: XReserveHttpTransport,
  params: { plan: BridgePlan; checkpoint: BridgeCheckpoint; signal?: AbortSignal | undefined }): Promise<BridgeReceipt> {
  const { plan, checkpoint } = params
  const c = context(registry, clients, plan), source = checkpoint.source
  if (!source) throw new BridgeError('Verulink checkpoint contains no source state')
  const prepared = source.preparedTransaction
  if (prepared && !source.transactionId) {
    if (!c.outbound || checkpoint.destination || source.approvalTransactionIds?.length) throw new BridgeError('Invalid Verulink prepared source checkpoint')
    validateAleoSource(c, plan, preparedTransaction(prepared.serializedTransaction, prepared.transactionId))
    return { id: prepared.transactionId, protocol: 'verulink', status: 'SOURCE_SUBMISSION_PENDING',
      protocolState: { routeId: c.route.id, sourceSender: plan.sender, preparedTransaction: prepared.serializedTransaction } }
  }
  const id = source.transactionId ?? source.approvalTransactionIds?.at(-1)
  if (!id || (!source.transactionId && checkpoint.destination) || (c.outbound && source.approvalTransactionIds?.length)) throw new BridgeError('Invalid Verulink checkpoint source identifiers')
  const pendingDestination = checkpoint.destination?.preparedTransaction
  if (pendingDestination && (c.outbound || checkpoint.destination?.transactionId)) throw new BridgeError('Invalid Verulink prepared destination checkpoint')
  const receipt: BridgeReceipt = { id: pendingDestination?.transactionId ?? id, protocol: 'verulink', status: source.transactionId ? 'SOURCE_CONFIRMING' : 'SOURCE_APPROVAL_PENDING',
    sourceTxId: source.transactionId, destinationTxId: checkpoint.destination?.transactionId,
    protocolState: { routeId: c.route.id, sourceSender: plan.sender, approvalTxIds: source.approvalTransactionIds ?? [],
      ...(pendingDestination ? { preparedDestinationTransaction: pendingDestination.serializedTransaction } : {}) } }
  return getStatus(registry, clients, fetcher, { plan, receipt, signal: params.signal })
}

/** Claims a positively attested public packet, with replay checks and durable destination checkpoints. */
export async function complete(registry: BridgeRegistry, clients: BridgeChainClients, fetcher: XReserveHttpTransport,
  params: CompleteParameters & { plan: BridgePlan; receipt: BridgeReceipt }): Promise<VerulinkExecution> {
  const { plan, receipt } = params
  const c = context(registry, clients, plan)
  if (receipt.destinationTxId) throw new BridgeError('Verulink claim already submitted; recover or wait instead of submitting again')
  if (receipt.status !== 'DESTINATION_ACTION_REQUIRED' || receipt.nextAction?.kind !== 'verulink-claim') throw new BridgeError('Verulink receipt has no destination claim ready')
  await assertActive(c)
  await configuration(c)
  const ready = await getStatus(registry, clients, fetcher, { plan, receipt })
  if (ready.status !== 'DESTINATION_ACTION_REQUIRED') throw new BridgeError('Verulink packet is consumed or no longer has a positive attestor quorum')
  const packet = ready.protocolState.packet as Packet, signatures = ready.protocolState.signatures as AttestorSignature[]
  const save = async (value: BridgeReceipt) => params.onCheckpoint?.(createBridgeCheckpoint(plan, value))
  let transactionId: string
  if (c.outbound) {
    const wallet = requireEvmClientWithWallet(registry, clients, c.evmChain.id, 'claim Verulink ALEO').walletClient
    const sender = await wallet.getAddress()
    const data = encodeFunctionData({ abi: ABI, functionName: 'tokenReceive', args: [incoming(packet), `0x${signatures.map(x => x.sign.slice(2)).join('')}`] })
    // eth_call executes quorum, blacklist, and token checks before requesting a signature.
    await c.evm.publicClient.call({ to: c.evmTokenService, data, account: sender })
    transactionId = await wallet.sendTransaction({ chainId: c.evmChainId, from: sender, to: c.evmTokenService, data })
  } else {
    const serialized = receipt.protocolState.preparedDestinationTransaction
    if (typeof serialized === 'string') {
      const tx = preparedTransaction(serialized, receipt.id)
      const values = inputs(validateAleoClaim(c, packet, tx))
      const attestors = values[5], signed = values[6]
      if (!Array.isArray(attestors) || !Array.isArray(signed) || attestors.length !== 5 || signed.length !== 5) throw new BridgeError('Invalid prepared Verulink attestor arrays')
      const supplied: AttestorSignature[] = []
      let padding = false
      for (let i = 0; i < 5; i++) {
        if (attestors[i] === ZERO_ALEO) { padding = true; continue }
        if (padding || typeof attestors[i] !== 'string' || typeof signed[i] !== 'string') throw new BridgeError('Invalid prepared Verulink attestor padding')
        supplied.push({ signer: attestors[i], sign: signed[i] })
      }
      const verified = await verifiedSignatures(c, packet, supplied)
      if (!verified || verified.length !== supplied.length) throw new BridgeError('Prepared Verulink claim lacks a positive attestor quorum')
      try {
        const submitted = await c.aleo.publicClient.request({ method: 'sendTransaction', params: { transaction: serialized } })
        if (submitted !== tx.id) throw new BridgeError('Verulink Aleo rebroadcast returned a different transaction id')
      } catch (error) {
        if (error instanceof BridgeError) throw error
        const classified = classifyBroadcastError(error, tx.id)
        if (!(classified instanceof DuplicateTransactionError)) throw classified
      }
      transactionId = tx.id
    } else {
      const wallet = requireAleoClientWithWallet(registry, clients, c.aleoChain.id, 'claim Verulink ALEO').walletClient
      const signers = signatures.map(x => x.signer), signed = signatures.map(x => x.sign)
      while (signers.length < 5) { signers.push(ZERO_ALEO); signed.push(signed[0]!) }
      transactionId = await wallet.executeTransaction({ program: c.aleoTokenService, function: 'token_receive_public', privateFee: params.privateFee ?? false,
        inputs: [addressLiteral(packet.sender), packet.recipient, `${packet.amount}u64`, `${packet.sequence}u64`, `${packet.height}u64`,
          `[${signers.join(', ')}]`, `[${signed.join(', ')}]`, `${packet.sourceChain}u128`, addressLiteral(packet.sourceAddress)],
        onProgress: async event => {
          if (event.type === 'transaction-prepared') await save({ ...ready, id: event.transaction.id,
            protocolState: { ...ready.protocolState, preparedDestinationTransaction: JSON.stringify(event.transaction) } })
          await params.onProgress?.(event)
        },
      })
    }
  }
  if (!transactionId || (c.outbound && !isHash(transactionId))) throw new BridgeError('Verulink wallet returned an invalid claim transaction id')
  const result = update({ ...ready, destinationTxId: transactionId }, 'DESTINATION_CONFIRMING', { preparedDestinationTransaction: undefined })
  await save(result)
  return { kind: c.outbound ? 'evm-verulink' : 'aleo-verulink', transactionId, receipt: result }
}
