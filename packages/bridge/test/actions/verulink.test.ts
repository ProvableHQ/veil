import { describe, expect, it, vi } from 'vitest'
import { decodeFunctionData, encodeFunctionResult, parseAbi, zeroAddress, type Hex } from 'viem'
import type { Client } from '@provablehq/veil-core'
import { createBridgeClient } from '../../src/clients/createBridgeClient.js'
import type { BridgeChainClients } from '../../src/connections/resolve.js'
import { VERULINK_METADATA as M } from '../../src/registry/verulink.js'
import type { BridgeCheckpoint } from '../../src/types/protocol.js'
import { createBridgeCheckpoint } from '../../src/actions/createBridgeCheckpoint.js'
import { execute as executeVerulink } from '../../src/protocols/verulink/source.js'
import { prepare } from '../../src/actions/prepare.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'

const aleo = 'aleo19lu7tcg5v3c7ke5gn98h0v7crsn4jcct4uck0u0q9ewuhtc0hc9s0rygds'
const evm = '0x78b4873616922c84159188e9f7098b6d57d777c3'
const ABI = parseAbi([
  'function paused() view returns (bool)', 'function erc20Bridge() view returns (address)',
  'function self() view returns (uint256 chainId,address addr)', 'function destChainId() view returns (uint256)',
  'function supportedTokens(address) view returns (address,address,string,string,uint256,uint256,bool)',
  'function feeCollector() view returns (address)', 'function platformFees(address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)',
  'function decimals() view returns (uint8)', 'function quorumRequired() view returns (uint256)',
  'function publicTokenSend(address,uint256,string)', 'function approve(address,uint256) returns (bool)',
  'function consumedPackets(uint256) view returns (bytes32)',
])
const bytes = (value: string) => `[${value.slice(2).padStart(64, '0').match(/../g)!.map(x => `${parseInt(x, 16)}u8`).join(', ')}]`
function setup(options: { rate?: bigint; paused?: boolean; chainId?: number; allowance?: bigint } = {}) {
  const sendTransaction = vi.fn(async () => `0x${'11'.repeat(32)}` as Hex)
  const executeTransaction = vi.fn(async () => 'at1source')
  const request = vi.fn(async ({ method, params }: { method: string; params: Record<string, unknown> }) => {
    if (method !== 'getMappingValue') throw new Error(`Unexpected Aleo read: ${method}`)
    const mapping = params.mapping
    if (mapping === 'platform_fee') return `${options.rate ?? 100n}u32`
    if (mapping === 'min_transfers') return '10000000u64'
    if (mapping === 'max_transfers') return '1000000000000000u64'
    if (mapping === 'status') return options.paused ? 'true' : 'false'
    if (mapping === 'bridge_settings') return params.key === '3u8' ? '1u8' : '3u8'
    if (mapping === 'other_chain_token_service') return bytes(M.evmTokenService)
    if (mapping === 'other_chain_token_address') return bytes(M.evmToken)
    if (mapping === 'supported_chains' || mapping === 'supported_services') return 'true'
    if (mapping === 'account' || mapping === 'total_supply') return '1000000000000000u64'
    throw new Error(`Unexpected mapping: ${mapping}`)
  })
  const call = vi.fn(async ({ data }: { data: Hex }) => {
    const { functionName } = decodeFunctionData({ abi: ABI, data })
    if (functionName === 'publicTokenSend') return '0x' as Hex
    if (functionName === 'approve') return encodeFunctionResult({ abi: ABI, functionName, result: true })
    const values = {
      paused: options.paused ?? false, erc20Bridge: M.evmBridge,
      self: [BigInt(M.evmDomain), M.evmTokenService], destChainId: BigInt(M.aleoDomain),
      supportedTokens: [M.evmToken, zeroAddress, M.aleoTokenId, M.aleoServiceAddress, 10000000n, 1000000000000000000n, true],
      feeCollector: '0x50bdd40C91eA0219d54B8689E4439AC98E44A628', platformFees: options.rate ?? 100n,
      balanceOf: 1000000000n, allowance: options.allowance ?? 0n, decimals: 6, quorumRequired: 3n,
      consumedPackets: `0x${'0'.repeat(64)}`,
    }
    return encodeFunctionResult({ abi: ABI, functionName, result: values[functionName] } as never)
  })
  const clients: BridgeChainClients = {
    aleo: { family: 'aleo', publicClient: { request } as unknown as Client,
      walletClient: { executeTransaction, account: { address: aleo } } as never },
    bsc: { family: 'evm', publicClient: {
      call, getChainId: async () => options.chainId ?? 56, getBalance: async () => 1000000000000000000n,
      getTransactionReceipt: vi.fn(async () => null), getTransaction: vi.fn(async () => null),
      getLogs: vi.fn(async () => []), getBlockNumber: async () => 1000n,
    }, walletClient: { getAddress: async () => evm, sendTransaction } },
  }
  return { bridge: createBridgeClient({ clients }), clients, request, call, sendTransaction, executeTransaction }
}
function intent(source = 'aleo', amount = '11.000001') {
  return { source: { chain: source, asset: 'aleo' }, destination: { chain: source === 'aleo' ? 'bsc' : 'aleo', asset: 'aleo' },
    amount, recipient: source === 'aleo' ? evm : aleo, sender: source === 'aleo' ? aleo : evm }
}

describe('Verulink public ALEO routes', () => {
  it.each(['aleo', 'bsc'])('prepares %s with an explicit destination wallet claim', (source) => {
    const destination = source === 'aleo' ? 'bsc' : 'aleo'
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: source, asset: 'aleo' }, destination: { chain: destination, asset: 'aleo' },
      amount: '11', recipient: destination === 'aleo' ? aleo : evm,
    })
    expect(plan.protocol).toBe('verulink')
    expect(plan.steps.find(step => step.key === 'destination-claim')).toMatchObject({
      executor: destination === 'aleo' ? 'aleo-wallet' : 'evm-wallet', chainId: destination,
    })
    expect(plan.steps.filter(step => step.irreversible)).toHaveLength(1)
  })

  it('rejects private BSC-to-Aleo delivery before involving a wallet', () => {
    expect(() => prepare(DEFAULT_BRIDGE_REGISTRY, {
      source: { chain: 'bsc', asset: 'aleo' }, destination: { chain: 'aleo', asset: 'aleo' },
      amount: '11', recipient: aleo, mintMode: 'private',
    })).toThrow(/only supported by xReserve/)
  })
})

function outgoingPacket(sequence = 1, amount = 10989001n) {
  return `{ version: 1u8, sequence: ${sequence}u64, source: { chain_id: ${M.aleoDomain}u128, addr: ${M.aleoServiceAddress} }, destination: { chain_id: ${M.evmDomain}u128, addr: ${bytes(M.evmTokenService)} }, message: { sender_address: ${aleo}, dest_token_address: ${bytes(M.evmToken)}, amount: ${amount}u128, receiver_address: ${bytes(evm)} }, height: 100u64 }`
}
function withAleoSource(s: ReturnType<typeof setup>, options: { ambiguous?: boolean; fee?: string } = {}) {
  const fallback = s.request.getMockImplementation()!
  const input = (value: string) => ({ type: 'public', value })
  s.request.mockImplementation(async args => {
    if (args.method === 'getConfirmedTransaction') return {
      status: 'accepted', transaction: { id: 'at1source', execution: { transitions: [
        { program: M.aleoBridge, function: 'publish', inputs: ['1u8', `${M.evmDomain}u128`, bytes(M.evmTokenService), bytes(M.evmToken), aleo, bytes(evm), '10989001u128'].map(input) },
        { program: M.aleoTokenService, function: 'token_send_public', inputs: [bytes(evm), '11000001u64', `${M.evmDomain}u128`, bytes(M.evmTokenService), bytes(M.evmToken), options.fee ?? '11000u64'].map(input) },
      ] } },
    } as never
    if (args.method === 'findBlockHash') return 'ab1block'
    if (args.method === 'getBlockHeightByHash') return 100 as never
    if (args.params.mapping === 'sequences') return options.ambiguous ? '3u64' : '2u64'
    if (args.params.mapping === 'out_packets') return outgoingPacket(String(args.params.key).includes('sequence: 2u64') ? 2 : 1)
    return fallback(args)
  })
}
function collectorPacket(overrides: Record<string, unknown> = {}) {
  return { packetId: 'untrusted-id', version: '1', sequence: 1, height: '100',
    sourceChain: M.aleoDomain, destinationChain: M.evmDomain,
    sourceAddress: M.aleoServiceAddress, destinationAddress: M.evmTokenService,
    message: { sender: aleo, receiver: evm, denom: M.evmToken, amount: '10989001' },
    status: { isClaimable: true, isClaimed: true, signatureCount: 3, threshold: 1, signatures: [] }, ...overrides }
}
describe('Verulink source packet recovery', () => {
  it('recovers the confirmed Aleo packet and ignores collector claim flags', async () => {
    const s = setup(); withAleoSource(s)
    const fetcher = vi.fn(async () => Response.json({ data: { currentPage: 1, totalPages: 1, data: [collectorPacket()] } }))
    const bridge = createBridgeClient({ clients: s.clients, fetch: fetcher as typeof fetch })
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, intent())
    const progress = await bridge.recover({ checkpoint: { version: 1, intent: { ...intent(), bridgeProtocol: 'verulink' }, route: { id: plan.route.id, registryVersion: plan.registryVersion }, source: { transactionId: 'at1source' } } })
    expect(progress.receipt.status).toBe('ATTESTATION_PENDING')
    expect(progress.receipt.protocolState.packet).toMatchObject({ sequence: '1', height: '100', amount: '10989001' })
    expect(fetcher.mock.calls[0]![0]).toContain(`/packet/wallet/${aleo}`)
    expect(s.executeTransaction).not.toHaveBeenCalled()
  })
  it('rejects ambiguous identical Aleo packets in the same block', async () => {
    const s = setup(); withAleoSource(s, { ambiguous: true })
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, intent())
    await expect(s.bridge.getStatus({ plan, receipt: { id: 'at1source', protocol: 'verulink', sourceTxId: 'at1source', status: 'SOURCE_CONFIRMING', protocolState: { routeId: plan.route.id } } })).rejects.toThrow(/ambiguous/i)
  })
  it('refuses a collector packet with a substituted recipient', async () => {
    const s = setup(); withAleoSource(s)
    const fetcher = async () => Response.json({ data: { currentPage: 1, totalPages: 1, data: [collectorPacket({ message: { sender: aleo, receiver: zeroAddress, denom: M.evmToken, amount: '10989001' } })] } })
    const bridge = createBridgeClient({ clients: s.clients, fetch: fetcher })
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, intent())
    await expect(bridge.getStatus({ plan, receipt: { id: 'at1source', protocol: 'verulink', sourceTxId: 'at1source', status: 'SOURCE_CONFIRMING', protocolState: { routeId: plan.route.id } } })).rejects.toThrow(/collector.*match/i)
  })
  it('rejects a source transaction whose declared fee disagrees with its published net amount', async () => {
    const s = setup(); withAleoSource(s, { fee: '1u64' })
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, intent())
    await expect(s.bridge.getStatus({ plan, receipt: { id: 'at1source', protocol: 'verulink', sourceTxId: 'at1source', status: 'SOURCE_CONFIRMING', protocolState: { routeId: plan.route.id } } })).rejects.toThrow(/packet.*match|publish.*match/i)
  })
})

describe('Verulink source submission', () => {
  it('refuses an approval-only resubmission without calling the wallet', async () => {
    const s = setup()
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, intent('bsc'))
    await expect(executeVerulink(DEFAULT_BRIDGE_REGISTRY, s.clients, { plan, resume: { id: 'approval', protocol: 'verulink',
      status: 'SOURCE_SUBMISSION_PENDING', protocolState: { routeId: plan.route.id, sourceSender: evm } } })).rejects.toThrow(/cannot safely resubmit/)
    expect(s.sendTransaction).not.toHaveBeenCalled()
  })
  it('rejects a worsened quote before signing', async () => {
    const s = setup()
    const { plan } = await s.bridge.quote(intent())
    await expect(s.bridge.execute({ plan: { ...plan, amountOut: '11' } })).rejects.toThrow(/fee increased/)
    expect(s.executeTransaction).not.toHaveBeenCalled()
  })
  it('submits Aleo public inputs with the exact current fee and checkpoints the source id', async () => {
    const { bridge, executeTransaction } = setup()
    const checkpoints: BridgeCheckpoint[] = []
    const { plan } = await bridge.quote(intent())
    const result = await bridge.execute({ plan, onCheckpoint: cp => { checkpoints.push(cp) } })
    expect(result).toMatchObject({ kind: 'aleo-verulink', receipt: { status: 'SOURCE_CONFIRMING', sourceTxId: 'at1source' } })
    expect(executeTransaction).toHaveBeenCalledWith(expect.objectContaining({
      program: M.aleoTokenService, function: 'token_send_public',
      inputs: [bytes(evm).replace(/^(\[)(0u8, ){12}/, '$1'), '11000001u64', `${M.evmDomain}u128`,
        bytes(M.evmTokenService).replace(/^(\[)(0u8, ){12}/, '$1'), bytes(M.evmToken).replace(/^(\[)(0u8, ){12}/, '$1'), '11000u64'],
    }))
    expect(checkpoints.at(-1)?.source?.transactionId).toBe('at1source')
  })
  it('returns a tracked approval when confirmation times out without burning', async () => {
    const { bridge, sendTransaction } = setup()
    const { plan } = await bridge.quote(intent('bsc'))
    const result = await bridge.execute({ plan, confirmationTimeoutMs: 0 })
    expect(result.receipt.status).toBe('SOURCE_APPROVAL_PENDING')
    expect(sendTransaction).toHaveBeenCalledTimes(1)
    expect(decodeFunctionData({ abi: ABI, data: sendTransaction.mock.calls[0]![0].data })).toMatchObject({
      functionName: 'approve', args: [M.evmTokenService, 11000001n],
    })
  })
  it('simulates then burns once when the full allowance exists', async () => {
    const { bridge, sendTransaction } = setup({ allowance: 11000001n })
    const { plan } = await bridge.quote(intent('bsc'))
    const result = await bridge.execute({ plan })
    expect(result.receipt.status).toBe('SOURCE_CONFIRMING')
    expect(sendTransaction).toHaveBeenCalledTimes(1)
    expect(decodeFunctionData({ abi: ABI, data: sendTransaction.mock.calls[0]![0].data })).toMatchObject({
      functionName: 'publicTokenSend', args: [M.evmToken, 11000001n, aleo],
    })
  })
  it('rejects a changed source signer before a source transaction', async () => {
    const { bridge, executeTransaction } = setup()
    const { plan } = await bridge.quote(intent())
    await expect(bridge.execute({ plan: { ...plan, sender: M.aleoServiceAddress } })).rejects.toThrow(/sender/)
    expect(executeTransaction).not.toHaveBeenCalled()
  })
  it('refuses a paused route before proving or signing', async () => {
    const { bridge, executeTransaction, sendTransaction } = setup({ paused: true })
    const plan = prepare(DEFAULT_BRIDGE_REGISTRY, intent())
    await expect(bridge.execute({ plan })).rejects.toThrow(/paused/)
    expect(executeTransaction).not.toHaveBeenCalled()
    expect(sendTransaction).not.toHaveBeenCalled()
  })
})

describe('Verulink onchain quotes', () => {
  it.each(['aleo', 'bsc'])('quotes %s with integer fee truncation and destination gas left unpriced', async source => {
    const { bridge, sendTransaction, executeTransaction } = setup()
    const quote = await bridge.quote(intent(source))
    expect(quote).toMatchObject({ protocol: 'verulink', amountOut: '10.989001', feeAtomic: 11000n, rate: 100n })
    expect(quote.plan.amountOut).toBe('10.989001')
    expect(quote.fees.filter(fee => fee.kind === 'network')).toHaveLength(2)
    expect(quote.fees.filter(fee => fee.kind === 'network').every(fee => fee.amount === undefined)).toBe(true)
    expect(sendTransaction).not.toHaveBeenCalled()
    expect(executeTransaction).not.toHaveBeenCalled()
  })
  it.each(['aleo', 'bsc'])('enforces %s minimum against net amount', async source => {
    await expect(setup().bridge.quote(intent(source, '10'))).rejects.toThrow(/net amount.*minimum/i)
    await expect(setup().bridge.quote(intent(source, '10.01001'))).resolves.toMatchObject({ amountOut: '10' })
  })
  it('rejects Aleo fee multiplication overflowing u64 before proving', async () => {
    await expect(setup().bridge.quote(intent('aleo', '184467440737.095517'))).rejects.toThrow(/u64/)
  })
  it('rejects a BSC transport connected to another chain', async () => {
    await expect(setup({ chainId: 1 }).bridge.quote(intent('bsc'))).rejects.toThrow(/chain.*56/i)
  })
  it('rejects an out-of-range fee rate', async () => {
    await expect(setup({ rate: 100001n }).bridge.quote(intent('aleo'))).rejects.toThrow(/rate/)
  })
})
