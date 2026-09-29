import { describe, expect, it, vi } from 'vitest'
import { concat, decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, pad, parseAbi, slice, stringToHex, toHex, zeroAddress, type Address, type Hash, type Hex } from 'viem'
import { prepare } from '../../src/actions/prepare.js'
import { createBridgeCheckpoint } from '../../src/actions/createBridgeCheckpoint.js'
import type { EvmClient, EvmReceipt } from '../../src/connections/evm.js'
import { complete, execute, getStatus, quote, recover } from '../../src/protocols/cctp/evm.js'
import { DEFAULT_BRIDGE_REGISTRY as registry } from '../../src/registry/default.js'
import type { BridgePlan, BridgeReceipt } from '../../src/types/protocol.js'

const sender = '0x0000000000000000000000000000000000000011' as Address
const recipient = '0x0000000000000000000000000000000000000022' as Address
const sourceHash = toHex(11, { size: 32 })
const approvalHash = toHex(12, { size: 32 })
const destinationHash = toHex(13, { size: 32 })
const nonce = toHex(123, { size: 32 })
const abi = parseAbi([
  'function balanceOf(address owner) view returns(uint256)',
  'function allowance(address owner,address spender) view returns(uint256)',
  'function approve(address spender,uint256 amount) returns(bool)',
  'function usedNonces(bytes32 nonce) view returns(uint256)',
  'event MessageSent(bytes message)',
  'event MessageReceived(address indexed caller,uint32 sourceDomain,bytes32 indexed nonce,bytes32 sender,uint32 indexed finalityThresholdExecuted,bytes messageBody)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
])
function exactTopics(topics: ReturnType<typeof encodeEventTopics>): Hex[] {
  return topics.map(topic => {
    if (typeof topic !== 'string') throw new Error('Fixture requires a concrete event topic')
    return topic
  })
}
function plan(forwarding = true, source = 'ethereum', destination = 'arc'): BridgePlan {
  return prepare(registry, { source: { chain: source, asset: 'usdc' }, destination: { chain: destination, asset: 'usdc' }, amount: '5', sender, recipient, cctp: { speed: source === 'arc' ? 'standard' : 'fast', forwarding, maxFee: '0.1' } })
}
function fixture(forwarding = true, hookVersion: 0 | 1 = 0, sourceChain = 'ethereum', destinationChain = 'arc') {
  const transfer = plan(forwarding, sourceChain, destinationChain)
  const finality = transfer.cctp?.speed === 'standard' ? 2000 : 1000
  const m = transfer.route.metadata!
  const messenger = m.tokenMessenger as Address
  const transmitter = m.messageTransmitter as Address
  const sourceToken = transfer.sourceAsset.locator!.value as Address
  const destinationToken = transfer.destinationAsset.locator!.value as Address
  const hook = forwarding ? concat([stringToHex('cctp-forward', { size: 24 }), toHex(hookVersion, { size: 4 }), toHex(0, { size: 4 })]) : '0x'
  const message = (attested: boolean) => concat([
    toHex(1, { size: 4 }), toHex(m.sourceDomain as number, { size: 4 }), toHex(m.destinationDomain as number, { size: 4 }),
    attested ? nonce : toHex(0, { size: 32 }), pad(messenger, { size: 32 }), pad(messenger, { size: 32 }), pad(zeroAddress, { size: 32 }),
    toHex(finality, { size: 4 }), toHex(attested ? finality : 0, { size: 4 }), toHex(1, { size: 4 }),
    pad(sourceToken, { size: 32 }), pad(recipient, { size: 32 }), toHex(5_000_000n, { size: 32 }), pad(sender, { size: 32 }),
    toHex(100_000n, { size: 32 }), toHex(attested ? 10_000 : 0, { size: 32 }), toHex(attested ? 999999999 : 0, { size: 32 }), hook,
  ])
  const burned = message(false)
  let attested = message(true)
  const sourceReceipt: EvmReceipt = { transactionHash: sourceHash, status: 'success', logs: [{ address: transmitter,
    topics: exactTopics(encodeEventTopics({ abi, eventName: 'MessageSent' })), data: encodeAbiParameters([{ type: 'bytes' }], [burned]) }] }
  const destinationReceipt: EvmReceipt = { transactionHash: destinationHash, status: 'success', logs: [
    { address: transmitter, topics: exactTopics(encodeEventTopics({ abi, eventName: 'MessageReceived', args: { caller: sender, nonce, finalityThresholdExecuted: finality } })),
      data: encodeAbiParameters([{ type: 'uint32' }, { type: 'bytes32' }, { type: 'bytes' }], [m.sourceDomain as number, pad(messenger, { size: 32 }), slice(attested, 148)]) },
    { address: destinationToken, topics: exactTopics(encodeEventTopics({ abi, eventName: 'Transfer', args: { from: zeroAddress, to: recipient } })),
      data: encodeAbiParameters([{ type: 'uint256' }], [4_990_000n]) },
  ] }
  let minedSource: EvmReceipt | null = sourceReceipt
  let minedDestination: EvmReceipt | null = destinationReceipt
  let used = 1n
  let allowance = 5_000_000n
  let balance = 10_000_000n
  let gasBalance = 1n
  let forwardingHash: string | undefined = forwarding ? destinationHash : undefined
  let minimumFee: number | string = '1.3'
  const fetch = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => url.includes('/fees/')
    ? [{ finalityThreshold: 1000, minimumFee, forwardFee: { medium: 1000 } }, { finalityThreshold: 2000, minimumFee: 0, forwardFee: { medium: 1000 } }]
    : { messages: [{ message: attested, attestation: '0xabcd', status: 'complete', forwardTxHash: forwardingHash }] } }))
  const source: EvmClient = { family: 'evm', publicClient: {
    getChainId: vi.fn(async () => m.sourceChainId as number), getBalance: vi.fn(async () => gasBalance),
    call: vi.fn(async ({ data }) => { const call = decodeFunctionData({ abi, data }); return toHex(call.functionName === 'balanceOf' ? balance : allowance, { size: 32 }) }),
    getTransactionReceipt: vi.fn(async hash => hash === approvalHash ? { status: 'success' as const, transactionHash: approvalHash, logs: [] } : minedSource),
    getTransaction: vi.fn(async hash => ({ hash, from: sender, to: sourceToken, blockNumber: 1n, input: encodeFunctionData({ abi, functionName: 'approve', args: [messenger, 5_000_000n] }) })),
    getLogs: vi.fn(async () => []),
  }, walletClient: { getAddress: vi.fn(async () => sender), sendTransaction: vi.fn(async ({ to }) => to === sourceToken ? approvalHash : sourceHash) } }
  const destination: EvmClient = { family: 'evm', publicClient: { ...source.publicClient,
    getChainId: vi.fn(async () => m.destinationChainId as number), call: vi.fn(async () => toHex(used, { size: 32 })),
    getTransactionReceipt: vi.fn(async () => minedDestination),
  }, walletClient: { getAddress: vi.fn(async () => sender), sendTransaction: vi.fn(async () => destinationHash) } }
  const receipt: BridgeReceipt = { id: sourceHash, protocol: 'cctp', status: 'SOURCE_CONFIRMING', sourceTxId: sourceHash, protocolState: { routeId: transfer.route.id, sourceSender: sender, approvalTxIds: [] } }
  return { transfer, source, destination, sourceReceipt, destinationReceipt, receipt, fetch, clients: { [sourceChain]: source, [destinationChain]: destination },
    pendingSource: () => { minedSource = null }, pendingDestination: () => { minedDestination = null },
    unused: () => { used = 0n }, noAllowance: () => { allowance = 0n }, noFunds: () => { balance = 0n }, noGas: () => { gasBalance = 0n },
    fee: (value: string | number) => { minimumFee = value },
    changeMessage: (value: Hex) => { attested = value }, attested, noForwardHash: () => { forwardingHash = undefined },
  }
}

describe('CCTP V2 adapter', () => {
  it('quotes decimal basis points, forwarding atomic fees, and defaults to Standard', async () => {
    const f = fixture()
    const q = await quote(registry, f.clients, f.fetch, { plan: f.transfer })
    expect(q.protocolFeeAtomic).toBe(650n)
    expect(q.forwardingFeeAtomic).toBe(1000n)
    expect(q.maxFeeAtomic).toBe(100_000n)
    const standard = await quote(registry, {}, f.fetch, { plan: { ...f.transfer, cctp: undefined } })
    expect(standard.plan.cctp).toEqual({ speed: 'standard', forwarding: true, maxFee: '0.001' })
    expect(f.fetch.mock.calls[0]?.[0]).toContain('?forward=true')
  })
  it('rejects a fee increase before any signature', async () => {
    const f = fixture(); f.fee(1000)
    await expect(execute(registry, f.clients, f.fetch, { plan: f.transfer })).rejects.toThrow('exceed the approved')
    expect(f.source.walletClient!.sendTransaction).not.toHaveBeenCalled()
  })
  it.each(['noFunds', 'noGas'] as const)('rejects %s before approval', async failure => {
    const f = fixture(); f.noAllowance(); f[failure]()
    await expect(execute(registry, f.clients, f.fetch, { plan: f.transfer })).rejects.toThrow(failure === 'noFunds' ? 'Insufficient' : 'native gas')
    expect(f.source.walletClient!.sendTransaction).not.toHaveBeenCalled()
  })
  it('checkpoints approval and burn immediately and returns a pending burn without retrying', async () => {
    const f = fixture(); f.noAllowance(); f.pendingSource()
    const saved: string[] = []
    const execution = await execute(registry, f.clients, f.fetch, { plan: f.transfer, confirmationTimeoutMs: 0,
      onCheckpoint: checkpoint => { saved.push(checkpoint.source?.transactionId ?? checkpoint.source!.approvalTransactionIds![0]!) } })
    expect(saved).toEqual([approvalHash, sourceHash])
    expect(execution.receipt.status).toBe('SOURCE_CONFIRMING')
    await execute(registry, f.clients, f.fetch, { plan: f.transfer, resume: execution.receipt })
    expect(f.source.walletClient!.sendTransaction).toHaveBeenCalledTimes(2)
  })
  it('uses the version-0 forwarding frame observed in successful mainnet delivery', async () => {
    const f = fixture(); f.pendingSource()
    await execute(registry, f.clients, f.fetch, { plan: f.transfer, confirmationTimeoutMs: 0 })
    const send = vi.mocked(f.source.walletClient!.sendTransaction).mock.calls[0]![0]
    const decoded = decodeFunctionData({
      abi: parseAbi(['function depositForBurnWithHook(uint256,uint32,bytes32,address,bytes32,uint256,uint32,bytes)']),
      data: send.data!,
    })
    expect(decoded.args[7]).toBe('0x636374702d666f72776172640000000000000000000000000000000000000000')
  })
  it('recovers a verified approval with no signature', async () => {
    const f = fixture()
    const approval: BridgeReceipt = { ...f.receipt, sourceTxId: undefined, protocolState: { ...f.receipt.protocolState, approvalTxIds: [approvalHash] } }
    const recovered = await recover(registry, f.clients, f.fetch, { checkpoint: createBridgeCheckpoint(f.transfer, approval), plan: f.transfer })
    expect(recovered.status).toBe('SOURCE_SUBMISSION_PENDING')
    expect(f.source.walletClient!.sendTransaction).not.toHaveBeenCalled()
  })
  it.each([0, 1] as const)('verifies exact mint evidence and recovers hook version %s', async version => {
    const f = fixture(true, version)
    expect((await getStatus(registry, f.clients, f.fetch, { plan: f.transfer, receipt: f.receipt })).status).toBe('COMPLETED')
    f.destinationReceipt.logs = f.destinationReceipt.logs.slice(0, 1)
    await expect(getStatus(registry, f.clients, f.fetch, { plan: f.transfer, receipt: f.receipt })).rejects.toThrow('expected USDC mint')
  })
  it('never marks a consumed nonce complete without the mint transaction', async () => {
    const f = fixture(); f.noForwardHash()
    expect((await getStatus(registry, f.clients, f.fetch, { plan: f.transfer, receipt: f.receipt })).status).toBe('DELIVERY_PENDING')
  })
  it('rejects source messages with a different amount before trusting the API', async () => {
    const f = fixture()
    await expect(getStatus(registry, f.clients, f.fetch, { plan: { ...f.transfer, amountIn: '6' }, receipt: f.receipt })).rejects.toThrow('exactly one CCTP message')
    expect(f.fetch).not.toHaveBeenCalled()
  })
  it('ignores attestations changing immutable burn intent', async () => {
    const f = fixture()
    f.changeMessage(concat([slice(f.attested, 0, 216), toHex(6_000_000n, { size: 32 }), slice(f.attested, 248)]))
    expect((await getStatus(registry, f.clients, f.fetch, { plan: f.transfer, receipt: f.receipt })).status).toBe('ATTESTATION_PENDING')
  })
  it('submits manual mint once and persists before confirmation', async () => {
    const f = fixture(false); f.unused(); f.pendingDestination()
    const checkpoint = vi.fn()
    const minted = await complete(registry, f.clients, f.fetch, { plan: f.transfer, receipt: f.receipt, onCheckpoint: checkpoint })
    expect(minted.receipt.status).toBe('DESTINATION_CONFIRMING')
    expect(checkpoint).toHaveBeenCalledOnce()
    await complete(registry, f.clients, f.fetch, { plan: f.transfer, receipt: minted.receipt })
    expect(f.destination.walletClient!.sendTransaction).toHaveBeenCalledOnce()
  })
  it('allows manual fallback after a verified reverted forwarding transaction', async () => {
    const f = fixture(); f.unused(); f.destinationReceipt.status = 'reverted'
    const ready = await getStatus(registry, f.clients, f.fetch, { plan: f.transfer, receipt: f.receipt })
    expect(ready.status).toBe('DESTINATION_ACTION_REQUIRED')
    expect(ready.nextAction?.kind).toBe('cctp-mint')
    await complete(registry, f.clients, f.fetch, { plan: f.transfer, receipt: ready })
    expect(f.destination.walletClient!.sendTransaction).toHaveBeenCalledOnce()
  })
  it('requires explicit fallback and gas to mint an attested burn whose forwarding never started', async () => {
    const f = fixture()
    f.unused(); f.noForwardHash()
    await expect(complete(registry, f.clients, f.fetch, { plan: f.transfer, receipt: f.receipt })).rejects.toThrow('not ready')
    await complete(registry, f.clients, f.fetch, { plan: f.transfer, receipt: f.receipt, cctp: { manualMint: true } })
    expect(f.destination.walletClient!.sendTransaction).toHaveBeenCalledOnce()
    expect(f.source.walletClient!.sendTransaction).not.toHaveBeenCalled()
    f.noGas()
    await expect(complete(registry, f.clients, f.fetch, { plan: f.transfer, receipt: f.receipt, cctp: { manualMint: true } })).rejects.toThrow('gas')
  })
  it('never manually mints a consumed nonce without destination evidence', async () => {
    const f = fixture()
    f.noForwardHash()
    await expect(complete(registry, f.clients, f.fetch, { plan: f.transfer, receipt: f.receipt, cctp: { manualMint: true } })).rejects.toThrow('not ready')
    expect(f.destination.walletClient!.sendTransaction).not.toHaveBeenCalled()
  })

})


describe.each([['ethereum', 1, 0], ['base', 8453, 6], ['arbitrum', 42161, 3]] as const)('Arc to %s CCTP', (destination, chainId, domain) => {
  it('quotes the correct domain and burns native Arc USDC', async () => {
    const f = fixture(true, 0, 'arc', destination)
    const priced = await quote(registry, f.clients, f.fetch, { plan: f.transfer })
    expect(f.fetch).toHaveBeenCalledWith(`https://iris-api.circle.com/v2/burn/USDC/fees/26/${domain}?forward=true`, undefined)
    expect(priced.minFinalityThreshold).toBe(2000)
    expect(f.transfer.route.metadata).toMatchObject({ sourceChainId: 5042, sourceDomain: 26, destinationChainId: chainId, destinationDomain: domain })
    f.pendingSource()
    const saved = vi.fn()
    await execute(registry, f.clients, f.fetch, { plan: priced.plan, confirmationTimeoutMs: 0, onCheckpoint: saved })
    const sent = vi.mocked(f.source.walletClient!.sendTransaction).mock.calls[0]![0]
    expect(sent.chainId).toBe(5042)
    const decoded = decodeFunctionData({ abi: parseAbi(['function depositForBurnWithHook(uint256,uint32,bytes32,address,bytes32,uint256,uint32,bytes)']), data: sent.data! })
    expect(decoded.args[1]).toBe(domain)
    expect(decoded.args[3]).toBe('0x3600000000000000000000000000000000000000')
    expect(saved).toHaveBeenCalledOnce()
    expect(f.destination.walletClient!.sendTransaction).not.toHaveBeenCalled()
  })
  it('recovers forwarded delivery from exact destination evidence without signatures', async () => {
    const f = fixture(true, 0, 'arc', destination)
    const receipt = await recover(registry, f.clients, f.fetch, { plan: f.transfer, checkpoint: createBridgeCheckpoint(f.transfer, f.receipt) })
    expect(receipt).toMatchObject({ status: 'COMPLETED', sourceTxId: sourceHash, destinationTxId: destinationHash })
    expect(f.source.walletClient!.sendTransaction).not.toHaveBeenCalled()
    expect(f.destination.walletClient!.sendTransaction).not.toHaveBeenCalled()
    f.destinationReceipt.logs = f.destinationReceipt.logs.slice(0, 1)
    await expect(getStatus(registry, f.clients, f.fetch, { plan: f.transfer, receipt: f.receipt })).rejects.toThrow('expected USDC mint')
  })
  it('submits manual completion only on the selected destination chain', async () => {
    const f = fixture(false, 0, 'arc', destination); f.unused(); f.pendingDestination()
    const result = await complete(registry, f.clients, f.fetch, { plan: f.transfer, receipt: f.receipt })
    expect(f.destination.walletClient!.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ chainId }))
    await complete(registry, f.clients, f.fetch, { plan: f.transfer, receipt: result.receipt })
    expect(f.destination.walletClient!.sendTransaction).toHaveBeenCalledOnce()
    expect(f.source.walletClient!.sendTransaction).not.toHaveBeenCalled()
  })
  it('rejects the wrong source RPC before requesting a signature', async () => {
    const f = fixture(true, 0, 'arc', destination)
    vi.mocked(f.source.publicClient.getChainId).mockResolvedValue(chainId)
    await expect(execute(registry, f.clients, f.fetch, { plan: f.transfer })).rejects.toThrow('chain 5042')
    expect(f.source.walletClient!.sendTransaction).not.toHaveBeenCalled()
  })
})


it('quotes forwarded delivery after the full approved fee budget', async () => {
  const f = fixture()
  const priced = await quote(registry, f.clients, f.fetch, { plan: f.transfer })
  expect(priced.amountOutAtomic).toBe(4_900_000n)
  expect(priced.plan.amountOut).toBe('4.9')
  // The separate fee fields retain the live service estimates; headroom is
  // visible in maxFee and must not be promised back to the recipient.
  expect(priced.protocolFeeAtomic + priced.forwardingFeeAtomic).toBe(1650n)
  const manual = fixture(false)
  expect((await quote(registry, manual.clients, manual.fetch, { plan: manual.transfer })).amountOutAtomic).toBe(4_999_350n)
})
