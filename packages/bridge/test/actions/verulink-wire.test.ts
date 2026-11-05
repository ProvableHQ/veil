import { describe, expect, it, vi } from 'vitest'
import { decodeFunctionData, encodeFunctionResult, encodeFunctionData, encodeEventTopics, encodeAbiParameters, zeroAddress } from 'viem'
import type { Client, Transaction } from '@provablehq/veil-core'
import fixture from '../fixtures/verulink-mainnet.json'
import { prepare } from '../../src/actions/prepare.js'
import { DEFAULT_BRIDGE_REGISTRY as registry } from '../../src/registry/default.js'
import type { BridgeChainClients } from '../../src/connections/resolve.js'
import { ABI } from '../../src/protocols/verulink/abi.js'
import { addressLiteral, context } from '../../src/protocols/verulink/common.js'
import { sourcePacket, incoming, packetHash, validateAleoSource, validateAleoClaim, type Packet } from '../../src/protocols/verulink/packets.js'
import { complete, getStatus } from '../../src/protocols/verulink/lifecycle.js'
import { fetchSignatures, verifiedSignatures } from '../../src/protocols/verulink/attestation.js'
import { createBridgeClient } from '../../src/clients/createBridgeClient.js'
import { createBridgeCheckpoint } from '../../src/actions/createBridgeCheckpoint.js'

// Public mainnet evidence: Aleo block 10461039 and BSC block 58692064.
// Signatures were retrieved from Verulink's public collector on 2026-11-04.
function setup(outbound: boolean) {
  const row = outbound ? fixture.toBsc : fixture.toAleo
  const packet: Packet = { version: row.version, sequence: String(row.sequence), height: row.height,
    sourceChain: row.sourceChain, destinationChain: row.destinationChain, sourceAddress: row.sourceAddress,
    destinationAddress: row.destinationAddress, sender: row.message.sender, recipient: row.message.receiver,
    token: row.message.denom, amount: row.message.amount }
  const tx = { ...fixture.bscSource.tx, blockNumber: BigInt(fixture.bscSource.tx.blockNumber) }
  const receipt = { ...fixture.bscSource.receipt, blockNumber: BigInt(fixture.bscSource.receipt.blockNumber) }
  const call = decodeFunctionData({ abi: ABI, data: tx.input as `0x${string}` })
  if (call.functionName !== 'publicTokenSend') throw new Error('Unexpected historical transaction')
  const plan = prepare(registry, {
    source: { chain: outbound ? 'aleo' : 'bsc', asset: 'aleo' }, destination: { chain: outbound ? 'bsc' : 'aleo', asset: 'aleo' },
    amount: outbound ? '10' : String(Number(call.args[1]) / 1000000), sender: packet.sender, recipient: packet.recipient,
  })
  const clients: BridgeChainClients = {
    aleo: { family: 'aleo', publicClient: { request: vi.fn(async ({ method, params }) => {
      if (method === 'getConfirmedTransaction') {
        if (params.id === fixture.aleoSource.transaction.id) return fixture.aleoSource
        throw new Error('Transaction not found')
      }
      if (method === 'findBlockHash') return 'ab1historical'
      if (method === 'getBlockHeightByHash') return 10461039
      if (params.mapping === 'sequences') return '2u64'
      if (params.mapping === 'out_packets') return fixture.aleoPacket
      if (params.mapping === 'bridge_settings') return params.key === '3u8' ? '1u8' : '3u8'
      if (params.mapping === 'in_packet_consumed') return 'false'
      if (params.mapping === 'status') return 'false'
      if (params.mapping === 'platform_fee') return '100u32'
      if (params.mapping === 'min_transfers') return '10000000u64'
      if (params.mapping === 'max_transfers') return '1000000000u64'
      if (params.mapping === 'supported_chains' || params.mapping === 'supported_services') return 'true'
      if (params.mapping === 'other_chain_token_service') return addressLiteral(registry.routes.at(-1)!.metadata!.evmTokenService as string, true)
      if (params.mapping === 'other_chain_token_address') return addressLiteral(registry.routes.at(-1)!.metadata!.evmToken as string, true)
      if (params.mapping === 'attestors') return 'true'
      throw new Error(`Unexpected read: ${method}`)
    }) } as unknown as Client },
    bsc: { family: 'evm', publicClient: {
      getChainId: async () => 56, getBalance: async () => 1n, getBlockNumber: async () => BigInt(row.height) + 20n,
      getTransactionReceipt: async () => receipt as never, getTransaction: async () => tx as never, getLogs: async () => [],
      call: async ({ data }) => {
        const call = decodeFunctionData({ abi: ABI, data })
        if (call.functionName === 'isAttestor') return encodeFunctionResult({ abi: ABI, functionName: call.functionName, result: true })
        if (call.functionName === 'quorumRequired') return encodeFunctionResult({ abi: ABI, functionName: call.functionName, result: 3n })
        const m = registry.routes.at(-1)!.metadata!
        const values: Record<string, unknown> = { paused: false, self: [BigInt(m.evmDomain as string), m.evmTokenService], destChainId: BigInt(m.aleoDomain as string),
          erc20Bridge: m.evmBridge, supportedTokens: [m.evmToken, zeroAddress, m.aleoTokenId, m.aleoServiceAddress, 10000000n, 1000000000n, true],
          decimals: 6, consumedPackets: '0x' + '00'.repeat(32), feeCollector: m.evmTokenService, platformFees: 100n }
        if (call.functionName === 'tokenReceive') return '0x'
        if (call.functionName in values) return encodeFunctionResult({ abi: ABI, functionName: call.functionName, result: values[call.functionName] } as never)
        throw new Error(`Unexpected call ${call.functionName}`)
      },
    } },
  }
  return { c: context(registry, clients, plan), plan, packet, signatures: row.status.signatures, clients, row }
}

describe('Verulink real mainnet wire fixtures', () => {
  it.each([true, false])('recovers the exact packet for outbound=%s', async outbound => {
    const { c, plan, packet } = setup(outbound)
    const id = outbound ? fixture.aleoSource.transaction.id : fixture.bscSource.tx.hash
    const recovered = await sourcePacket(c, plan, id)
    expect(typeof recovered).toBe('object')
    expect(Object.fromEntries(Object.entries(recovered).map(([key, value]) => [key, value.toLowerCase()]))).toEqual(Object.fromEntries(Object.entries(packet).map(([key, value]) => [key, value.toLowerCase()])))
  })
  it.each([true, false])('verifies real attestor signatures for outbound=%s', async outbound => {
    const { c, packet, signatures } = setup(outbound)
    const verified = await verifiedSignatures(c, packet, signatures)
    expect(verified).toHaveLength(3)
    await expect(verifiedSignatures(c, { ...packet, amount: '10000001' }, signatures)).rejects.toThrow(/signature/)
  })
})

describe('Verulink recovery and delivery safety', () => {
  it.each([false, true])('preserves and follows a prepared Aleo claim while consumed=%s', async initiallyConsumed => {
    const { c, clients, plan, packet, row } = setup(false)
    const input = (value: string) => ({ type: 'public', value })
    const signers = row.status.signatures.map(value => value.signer)
    const signed = row.status.signatures.map(value => value.sign)
    while (signers.length < 5) {
      signers.push('aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc')
      signed.push(signed[0]!)
    }
    const claim = { id: 'at1prepared', execution: { transitions: [
      { program: 'credits.aleo', function: 'transfer_public', inputs: [packet.recipient, packet.amount + 'u64'].map(input) },
      { program: c.aleoTokenService, function: 'token_receive_public', outputs: [{ type: 'public', value: 'true' }],
        inputs: [addressLiteral(packet.sender), packet.recipient, packet.amount + 'u64', packet.sequence + 'u64', packet.height + 'u64',
          '[' + signers.join(', ') + ']', '[' + signed.join(', ') + ']', packet.sourceChain + 'u128', addressLiteral(packet.sourceAddress)].map(input) },
    ] } }
    const prepared = { transactionId: claim.id, serializedTransaction: JSON.stringify(claim) }
    let accepted = false, signaturesAvailable = false
    const request = c.aleo.publicClient.request
    const submitted: unknown[] = []
    c.aleo.publicClient.request = (async args => {
      if (args.method === 'getConfirmedTransaction') {
        if (!accepted) throw new Error('Claim is not indexed yet')
        return { status: 'accepted', transaction: claim }
      }
      if (args.method === 'getUnconfirmedTransaction') return claim
      if (args.method === 'getMappingValue' && args.params.mapping === 'in_packet_consumed') return String(initiallyConsumed || accepted)
      if (args.method === 'sendTransaction') { submitted.push(args.params.transaction); return claim.id }
      return request(args)
    }) as typeof request
    const fetcher = async () => Response.json({ data: { currentPage: 1, totalPages: 1, data: signaturesAvailable ? [row] : [] } })
    // Recovery and rebroadcast must work without a wallet capable of proving again.
    const bridge = createBridgeClient({ clients, fetch: fetcher })
    const checkpoint = createBridgeCheckpoint(plan, { id: claim.id, protocol: 'verulink', status: 'DESTINATION_ACTION_REQUIRED',
      sourceTxId: fixture.bscSource.tx.hash, protocolState: { routeId: plan.route.id, preparedDestinationTransaction: prepared.serializedTransaction } })
    let progress = await bridge.recover({ checkpoint })
    expect(progress.receipt.status).toBe(initiallyConsumed ? 'DELIVERY_PENDING' : 'ATTESTATION_PENDING')
    const saved = JSON.parse(JSON.stringify(createBridgeCheckpoint(progress.plan, progress.receipt)))
    expect(saved.destination?.preparedTransaction).toEqual(prepared)
    progress = await bridge.recover({ checkpoint: saved })
    expect(createBridgeCheckpoint(progress.plan, progress.receipt).destination?.preparedTransaction).toEqual(prepared)

    if (initiallyConsumed) {
      // Once indexing catches up, ordinary polling must verify the saved claim.
      accepted = true
      progress = await bridge.wait({ progress, timeoutMs: 0 })
      expect(progress.next).toBe('done')
      expect(createBridgeCheckpoint(progress.plan, progress.receipt).destination).toEqual({ transactionId: claim.id })
      expect(submitted).toEqual([])
    } else {
      signaturesAvailable = true
      progress = await bridge.wait({ progress, timeoutMs: 0 })
      expect(progress.next).toBe('complete')
      const execution = await bridge.complete({ progress })
      expect(execution.transactionId).toBe(claim.id)
      expect(submitted).toEqual([prepared.serializedTransaction])
      expect(createBridgeCheckpoint(progress.plan, execution.receipt).destination).toEqual({ transactionId: claim.id })
    }
  })

  it('rejects substituted prepared source recipients and unrelated root calls', () => {
    const { c, plan } = setup(true)
    const original = fixture.aleoSource.transaction as unknown as Transaction
    expect(() => validateAleoSource(c, plan, original)).not.toThrow()
    const wrong = structuredClone(original)
    wrong.execution!.transitions.at(-1)!.inputs![1]!.value = '20000000u64'
    expect(() => validateAleoSource(c, plan, wrong)).toThrow(/source inputs/)
    const extra = structuredClone(original)
    extra.execution!.transitions.push({ program: 'credits.aleo', function: 'transfer_public', inputs: [] } as never)
    expect(() => validateAleoSource(c, plan, extra)).toThrow(/root/)
  })

  it('rejects a prepared claim for a different packet', () => {
    const { c, packet } = setup(false)
    const input = (value: string) => ({ type: 'public', value })
    const bytes = (value: string) => '[' + Array.from(Buffer.from(value.slice(2), 'hex')).map(n => n + 'u8').join(', ') + ']'
    const tx = { execution: { transitions: [{ program: c.aleoTokenService, function: 'token_receive_public',
      inputs: [bytes(packet.sender), packet.recipient, packet.amount + 'u64', packet.sequence + 'u64', packet.height + 'u64',
        '[]', '[]', packet.sourceChain + 'u128', bytes(packet.sourceAddress)].map(input) }] } } as unknown as Transaction
    expect(() => validateAleoClaim(c, packet, tx)).not.toThrow()
    expect(() => validateAleoClaim(c, { ...packet, sequence: '999' }, tx)).toThrow(/claim/)
  })

  it('requires BSC finality and exact recipient mint evidence', async () => {
    const { c, clients, plan, packet } = setup(true)
    const id = ('0x' + 'ab'.repeat(32)) as `0x${string}`
    const baseCall = clients.bsc!.family === 'evm' ? clients.bsc!.publicClient.call : null
    c.evm.publicClient.call = async params => {
      const decoded = decodeFunctionData({ abi: ABI, data: params.data })
      if (decoded.functionName === 'consumedPackets') return encodeFunctionResult({ abi: ABI, functionName: decoded.functionName, result: packetHash(packet) })
      return baseCall!(params)
    }
    const consume = { address: c.evmBridge, topics: encodeEventTopics({ abi: ABI, eventName: 'Consumed' }),
      data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'uint8' }],
        [BigInt(packet.sourceChain), BigInt(packet.sequence), packetHash(packet), 1]) }
    const mint = { address: c.evmToken, topics: encodeEventTopics({ abi: ABI, eventName: 'Transfer', args: { from: zeroAddress, to: packet.recipient as `0x${string}` } }),
      data: encodeAbiParameters([{ type: 'uint256' }], [BigInt(packet.amount)]) }
    const result = { status: 'success' as const, transactionHash: id, blockNumber: 100n, logs: [consume, mint] }
    c.evm.publicClient.getTransactionReceipt = async () => result
    c.evm.publicClient.getTransaction = async () => ({ hash: id, from: zeroAddress, to: c.evmTokenService, blockNumber: 100n,
      input: encodeFunctionData({ abi: ABI, functionName: 'tokenReceive', args: [incoming(packet), '0x'] }) })
    const receipt = { id: fixture.aleoSource.transaction.id, sourceTxId: fixture.aleoSource.transaction.id, destinationTxId: id,
      protocol: 'verulink' as const, status: 'DESTINATION_CONFIRMING' as const, protocolState: { routeId: plan.route.id } }
    c.evm.publicClient.getBlockNumber = async () => 100n
    expect((await getStatus(registry, clients, fetch, { plan, receipt })).status).toBe('DESTINATION_CONFIRMING')
    c.evm.publicClient.getBlockNumber = async () => 114n
    expect((await getStatus(registry, clients, fetch, { plan, receipt })).status).toBe('COMPLETED')
    result.logs = [consume]
    await expect(getStatus(registry, clients, fetch, { plan, receipt })).rejects.toThrow(/delivery/)
    const { destinationTxId: _, ...withoutDestination } = receipt
    expect((await getStatus(registry, clients, fetch, { plan, receipt: withoutDestination })).status).toBe('DELIVERY_PENDING')
  })

  it.each([true, false])('rejects duplicate attestors for outbound=%s', async outbound => {
    const { c, packet, signatures } = setup(outbound)
    await expect(verifiedSignatures(c, packet, [signatures[0]!, signatures[0]!, signatures[1]!])).rejects.toThrow(/Duplicate/)
  })

  it('checks collector pagination and finds the source packet on a later page', async () => {
    const { c, packet, row } = setup(true)
    const fetcher = vi.fn(async url => Response.json({ data: { currentPage: String(url).endsWith('page=1') ? 1 : 2, totalPages: 2,
      data: String(url).endsWith('page=1') ? [] : [row] } }))
    expect(await fetchSignatures(c, fetcher, packet)).toEqual(row.status.signatures)
    expect(fetcher).toHaveBeenCalledTimes(2)
    await expect(fetchSignatures(c, async () => Response.json({ data: { currentPage: 2, totalPages: 2, data: [row] } }), packet)).rejects.toThrow(/pagination/)
  })
})

describe('Verulink claim execution', () => {
  it.each([true, false])('claims only verified positive signatures for outbound=%s', async outbound => {
    const { c, clients, plan, packet, row } = setup(outbound)
    const evmSend = vi.fn(async () => ('0x' + 'ab'.repeat(32)) as `0x${string}`)
    const aleoSend = vi.fn(async () => 'at1claim')
    c.evm.walletClient = { getAddress: async () => '0x0000000000000000000000000000000000000001', sendTransaction: evmSend }
    c.aleo.walletClient = { executeTransaction: aleoSend } as never
    const fetcher = async () => Response.json({ data: { currentPage: 1, totalPages: 1, data: [row] } })
    const sourceTxId = outbound ? fixture.aleoSource.transaction.id : fixture.bscSource.tx.hash
    const receipt = await getStatus(registry, clients, fetcher, { plan, receipt: {
      id: sourceTxId, sourceTxId, protocol: 'verulink', status: 'SOURCE_CONFIRMING', protocolState: { routeId: plan.route.id },
    } })
    expect(receipt.status).toBe('DESTINATION_ACTION_REQUIRED')
    const checkpoints: unknown[] = []
    const execution = await complete(registry, clients, fetcher, { plan, receipt, onCheckpoint: cp => { checkpoints.push(cp) } })
    expect(execution.receipt.status).toBe('DESTINATION_CONFIRMING')
    expect(checkpoints).toHaveLength(1)
    if (outbound) {
      expect(evmSend).toHaveBeenCalledTimes(1)
      const call = decodeFunctionData({ abi: ABI, data: (evmSend.mock.calls[0] as unknown as [{ data: `0x${string}` }])[0].data })
      expect(call.functionName).toBe('tokenReceive')
    } else {
      expect(aleoSend).toHaveBeenCalledWith(expect.objectContaining({ function: 'token_receive_public',
        inputs: expect.arrayContaining([packet.recipient, packet.amount + 'u64', packet.sequence + 'u64']) }))
    }
    await expect(complete(registry, clients, fetcher, { plan, receipt: execution.receipt })).rejects.toThrow(/already submitted/)
    if (!outbound) {
      const sent = (aleoSend.mock.calls[0] as unknown as [{ inputs: string[] }])[0]
      const wrong = [...sent.inputs]
      wrong[6] = '[' + row.status.signatures.map(() => row.status.signatures[0]!.sign).concat([row.status.signatures[0]!.sign, row.status.signatures[0]!.sign]).join(', ') + ']'
      const prepared = { id: 'at1prepared', execution: { transitions: [{ program: c.aleoTokenService, function: 'token_receive_public',
        inputs: wrong.map(value => ({ type: 'public', value })) }] } }
      await expect(complete(registry, clients, fetcher, { plan, receipt: { ...receipt, id: prepared.id,
        protocolState: { ...receipt.protocolState, preparedDestinationTransaction: JSON.stringify(prepared) } } })).rejects.toThrow(/signature/)
      expect(aleoSend).toHaveBeenCalledTimes(1)
    }
  })

  it('verifies Aleo public delivery and distinguishes screening holding', async () => {
    const { c, clients, plan, packet } = setup(false)
    const request = c.aleo.publicClient.request
    let screened = true
    c.aleo.publicClient.request = (async args => {
      if (args.method === 'getMappingValue' && args.params.mapping === 'in_packet_consumed') return 'true'
      if (args.method === 'getConfirmedTransaction') return { status: 'accepted', transaction: { id: 'at1claim', execution: { transitions: [
        { program: 'credits.aleo', function: 'transfer_public', inputs: [packet.recipient, packet.amount + 'u64'].map(value => ({ type: 'public', value })) },
        { program: c.aleoTokenService, function: 'token_receive_public', outputs: [{ type: 'public', value: String(screened) }],
          inputs: [addressLiteral(packet.sender), packet.recipient, packet.amount + 'u64', packet.sequence + 'u64', packet.height + 'u64',
            '[]', '[]', packet.sourceChain + 'u128', addressLiteral(packet.sourceAddress)].map(value => ({ type: 'public', value })) },
      ] } } }
      return request(args)
    }) as typeof request
    const receipt = { id: fixture.bscSource.tx.hash, sourceTxId: fixture.bscSource.tx.hash, destinationTxId: 'at1claim',
      protocol: 'verulink' as const, status: 'DESTINATION_CONFIRMING' as const, protocolState: { routeId: plan.route.id } }
    expect((await getStatus(registry, clients, fetch, { plan, receipt })).status).toBe('COMPLETED')
    screened = false
    expect(await getStatus(registry, clients, fetch, { plan, receipt })).toMatchObject({ status: 'FAILED', protocolState: { held: true } })
  })
})
