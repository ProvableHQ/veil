import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runTestnetEthExample } from '../../examples/testnet-eth.js'
import { TESTNET_ETH_REGISTRY } from '../../examples/testnet-eth-registry.js'
import { createBridgeCheckpoint } from '../../src/index.js'
import { prepare } from '../../src/actions/prepare.js'

const mocks = vi.hoisted(() => ({
  address: 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n',
  quote: vi.fn(), privateQuote: vi.fn(), execute: vi.fn(), complete: vi.fn(), recover: vi.fn(), resume: vi.fn(), wait: vi.fn(),
  getProgram: vi.fn(), readContract: vi.fn(), getChainId: vi.fn(), derive: vi.fn(), proof: vi.fn(), tree: vi.fn(), config: vi.fn(),
}))

vi.mock('../../examples/testnet-eth-registry.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../examples/testnet-eth-registry.js')>()
  const { createHash } = await import('node:crypto')
  return { TESTNET_ETH_REGISTRY: { ...actual.TESTNET_ETH_REGISTRY,
    routes: actual.TESTNET_ETH_REGISTRY.routes.map(route => ({ ...route, metadata: { ...route.metadata,
      programSourceSha256: createHash('sha256').update('reviewed program').digest('hex'),
    } })),
  } }
})
vi.mock('@provablehq/veil-aleo-sdk', () => ({ loadNetwork: async () => ({
  createAleoClient: () => ({ account: { address: mocks.address }, walletClient: {},
    publicClient: { getProgram: mocks.getProgram, readContract: mocks.readContract, getComplianceFreezeList: mocks.tree },
  }), generateFreezelistProof: mocks.proof,
}) }))
vi.mock('@provablehq/aleo-bridge-sdk', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/index.js')>(),
  createAleoClient: (config: unknown) => config,
  createEvmClient: () => ({ publicClient: { getChainId: mocks.getChainId } }),
  deriveXReservePrivateMintAddressCommitment: mocks.derive,
  createBridgeClient: (config: { registry: unknown }) => {
    mocks.config(config)
    return { registry: config.registry, quote: mocks.quote, execute: mocks.execute, complete: mocks.complete,
      recover: mocks.recover, resume: mocks.resume, wait: mocks.wait }
  },
  hyperlane: { aleo: { quotePrivateTransfer: mocks.privateQuote } },
}))

describe('private testnet ETH CLI', () => {
  let directory: string
  let statePath: string
  const read = () => JSON.parse(readFileSync(statePath, 'utf8'))
  const receipt = (plan: ReturnType<typeof prepare>, status: string, extra = {}) => ({
    id: 'test-transaction', protocol: 'hyperlane', status,
    protocolState: { routeId: plan.route.id }, ...extra,
  })
  const mintPlan = () => prepare(TESTNET_ETH_REGISTRY, {
    source: { chain: 'sepolia', asset: 'eth' }, destination: { chain: 'aleo-testnet', asset: 'eth' }, amount: '0.001',
    recipient: mocks.address, mintMode: 'private', hyperlane: { addressEncoding: { commitmentHex: '11'.repeat(32) } },
  })

  beforeEach(() => {
    vi.resetAllMocks()
    directory = mkdtempSync(join(tmpdir(), 'veil-testnet-eth-')); statePath = join(directory, 'state.json')
    vi.stubEnv('ALEO_PRIVATE_KEY', 'test-only')
    vi.stubEnv('EVM_PRIVATE_KEY', '11'.repeat(32))
    vi.stubEnv('SEPOLIA_RECIPIENT', '0x1111111111111111111111111111111111111111')
    vi.stubEnv('EXECUTE_BRIDGE', '')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'table').mockImplementation(() => {})
    mocks.getChainId.mockResolvedValue(11155111)
    mocks.getProgram.mockResolvedValue('reviewed program')
    mocks.readContract.mockImplementation(async ({ mapping }) => {
      if (mapping === 'mailbox') return '{ local_domain: 1617853565u32 }'
      if (mapping === 'bridge_pause') return '[false, false]'
      if (mapping === 'freeze_list_root') return '123field'
      throw new Error(`Unexpected mapping ${mapping}`)
    })
    mocks.derive.mockResolvedValue('11'.repeat(32))
    mocks.tree.mockResolvedValue(['1', '2', '123'])
    mocks.proof.mockResolvedValue('[verified proofs]')
    mocks.quote.mockImplementation(async params => ({ plan: prepare(TESTNET_ETH_REGISTRY, params), kind: 'evm-hyperlane', nativeValueAtomic: 1000000000000001n, nativeFeeAtomic: 1n }))
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); rmSync(directory, { recursive: true, force: true }) })

  it('quotes private minting without signing and reuses its persisted local identity', async () => {
    await runTestnetEthExample('mint', { statePath, execute: false })
    const first = read()
    await runTestnetEthExample('mint', { statePath, execute: false })
    expect(read().secretNonce).toBe(first.secretNonce)
    expect(mocks.derive).toHaveBeenCalledTimes(1)
    expect(mocks.quote).toHaveBeenCalledWith(expect.objectContaining({ mintMode: 'private', hyperlane: { addressEncoding: { commitmentHex: '11'.repeat(32) } } }))
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(statSync(statePath).mode & 0o777).toBe(0o600)
    expect(JSON.stringify(vi.mocked(console.table).mock.calls)).not.toContain(first.secretNonce)
  })

  it('saves the original identity before deposit and completes the funded five-input claim with explicit local inputs', async () => {
    const plan = mintPlan()
    mocks.execute.mockImplementationOnce(async ({ onCheckpoint }) => {
      expect(read()).toMatchObject({ sourceAttempted: true, commitmentHex: '11'.repeat(32) })
      onCheckpoint(createBridgeCheckpoint(plan, receipt(plan, 'SOURCE_CONFIRMING', { sourceTxId: '0x' + '22'.repeat(32) }) as never))
      return { receipt: receipt(plan, 'SOURCE_CONFIRMING') }
    })
    mocks.wait.mockResolvedValueOnce({ next: 'complete', plan, receipt: receipt(plan, 'DESTINATION_ACTION_REQUIRED') })
      .mockResolvedValueOnce({ next: 'done', plan, receipt: receipt(plan, 'COMPLETED', { destinationTxId: 'at1claim' }) })
    mocks.complete.mockImplementationOnce(async ({ hyperlane, onCheckpoint }) => {
      expect(read().claimAttempted).toBe(true)
      expect(hyperlane).toEqual({ secretNonce: read().secretNonce, merkleProof: '[verified proofs]' })
      onCheckpoint(createBridgeCheckpoint(plan, receipt(plan, 'DESTINATION_CONFIRMING', { destinationTxId: 'at1claim' }) as never))
      return { receipt: receipt(plan, 'DESTINATION_CONFIRMING') }
    })
    await runTestnetEthExample('mint', { statePath, execute: true })
    expect(mocks.proof).toHaveBeenCalledWith({ address: mocks.address, tree: ['1', '2', '123'], root: '123field' })
    expect(JSON.stringify(read().checkpoint)).not.toContain(read().secretNonce)
    expect(read().claimAttempted).toBe(false)
  })

  it('recovers a funded deposit after a source timeout without dispatching again', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('Source timeout'))
    await expect(runTestnetEthExample('mint', { statePath, execute: true })).rejects.toThrow('Source timeout')
    const plan = mintPlan()
    mocks.recover.mockResolvedValue({ next: 'complete', plan, receipt: receipt(plan, 'DESTINATION_ACTION_REQUIRED') })
    await runTestnetEthExample('recover', { statePath, execute: true })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(read().commitmentHex).toBe('11'.repeat(32))
  })

  it('refuses a second claim when the first submission outcome is unknown', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('Source timeout'))
    await expect(runTestnetEthExample('mint', { statePath, execute: true })).rejects.toThrow()
    const plan = mintPlan()
    mocks.recover.mockResolvedValue({ next: 'complete', plan, receipt: receipt(plan, 'DESTINATION_ACTION_REQUIRED') })
    mocks.complete.mockRejectedValueOnce(new Error('Claim timeout'))
    await expect(runTestnetEthExample('claim', { statePath, execute: true })).rejects.toThrow('Claim timeout')
    await expect(runTestnetEthExample('claim', { statePath, execute: true })).rejects.toThrow('Prior claim submission outcome unknown')
    expect(mocks.complete).toHaveBeenCalledTimes(1)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('rebroadcasts a saved claim without requiring a secret or generating another proof', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('Source timeout'))
    await expect(runTestnetEthExample('mint', { statePath, execute: true })).rejects.toThrow()
    const state = read()
    delete state.secretNonce
    state.claimAttempted = true
    writeFileSync(statePath, JSON.stringify(state))
    const plan = mintPlan()
    const prepared = receipt(plan, 'DESTINATION_ACTION_REQUIRED', {
      protocolState: { routeId: plan.route.id, preparedDestinationTransaction: '{"encrypted":"claim"}' },
    })
    mocks.recover.mockResolvedValue({ next: 'complete', plan, receipt: prepared })
    mocks.complete.mockResolvedValue({ receipt: receipt(plan, 'DESTINATION_CONFIRMING') })
    mocks.wait.mockResolvedValue({ next: 'done', plan, receipt: receipt(plan, 'COMPLETED') })
    await runTestnetEthExample('claim', { statePath, execute: true })
    expect(mocks.complete).toHaveBeenCalledWith(expect.not.objectContaining({ hyperlane: expect.anything() }))
    expect(mocks.proof).not.toHaveBeenCalled()
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('executes withdrawal through the private quote and refuses a blind retry after an unknown source outcome', async () => {
    const quote = { protocolFeeAtomic: 2500000000000n, amountOut: '0.0009975', dispatchCreditsRecordMicrocredits: 1000n }
    mocks.privateQuote.mockResolvedValue(quote)
    mocks.execute.mockRejectedValueOnce(new Error('Withdrawal timeout'))
    await expect(runTestnetEthExample('withdraw', { statePath, execute: true })).rejects.toThrow('Withdrawal timeout')
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ hyperlanePrivateTransfer: { quote } }))
    expect(mocks.config).toHaveBeenCalledWith(expect.objectContaining({ environment: 'testnet', clients: expect.objectContaining({ sepolia: expect.anything(), 'aleo-testnet': expect.anything() }) }))
    await expect(runTestnetEthExample('withdraw', { statePath, execute: true })).rejects.toThrow('Source submission outcome unknown')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('observes a prepared withdrawal until explicit resume broadcasts the saved transaction', async () => {
    const plan = prepare(TESTNET_ETH_REGISTRY, {
      source: { chain: 'aleo-testnet', asset: 'eth' }, destination: { chain: 'sepolia', asset: 'eth' },
      amount: '0.001', recipient: '0x1111111111111111111111111111111111111111', sender: mocks.address,
    })
    const prepared = receipt(plan, 'SOURCE_SUBMISSION_PENDING')
    prepared.protocolState = { ...prepared.protocolState, preparedTransaction: '{"id":"test-transaction"}' } as typeof prepared.protocolState
    const checkpoint = createBridgeCheckpoint(plan, prepared as never)
    mocks.privateQuote.mockResolvedValue({ protocolFeeAtomic: 0n, amountOut: '0.001', dispatchCreditsRecordMicrocredits: 1000n })
    mocks.execute.mockImplementationOnce(async ({ onCheckpoint }) => {
      onCheckpoint(checkpoint)
      throw new Error('Stopped before broadcast')
    })
    await expect(runTestnetEthExample('withdraw', { statePath, execute: true })).rejects.toThrow('Stopped before broadcast')
    mocks.recover.mockResolvedValue({ next: 'resume', plan, receipt: prepared })
    await runTestnetEthExample('recover', { statePath, execute: true })
    expect(mocks.resume).not.toHaveBeenCalled()
    mocks.resume.mockResolvedValue({ receipt: receipt(plan, 'SOURCE_CONFIRMING') })
    mocks.wait.mockResolvedValue({ next: 'done', plan, receipt: receipt(plan, 'COMPLETED') })
    await runTestnetEthExample('resume', { statePath, execute: true })
    expect(mocks.resume).toHaveBeenCalledWith(expect.objectContaining({ progress: expect.objectContaining({ next: 'resume' }) }))
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    expect(mocks.privateQuote).toHaveBeenCalledTimes(1)
  })

  it.each(['chain', 'program', 'pause'])('rejects changed %s state before a source submission', async failure => {
    if (failure === 'chain') mocks.getChainId.mockResolvedValue(1)
    if (failure === 'program') mocks.getProgram.mockResolvedValue('unreviewed program')
    if (failure === 'pause') mocks.readContract.mockImplementation(async ({ mapping }) => mapping === 'mailbox' ? '{ local_domain: 1617853565u32 }' : '[true, false]')
    await expect(runTestnetEthExample('mint', { statePath, execute: true })).rejects.toThrow()
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.complete).not.toHaveBeenCalled()
  })

  it('rejects changed intent and concurrent access without discarding saved recovery state', async () => {
    await runTestnetEthExample('mint', { statePath, execute: false })
    const original = readFileSync(statePath, 'utf8')
    await expect(runTestnetEthExample('mint', { statePath, amount: '2' })).rejects.toThrow('Amount differs')
    writeFileSync(statePath + '.lock', '')
    await expect(runTestnetEthExample('mint', { statePath })).rejects.toMatchObject({ code: 'EEXIST' })
    expect(readFileSync(statePath, 'utf8')).toBe(original)
  })
})
