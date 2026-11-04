import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runVerulinkRoundtrip } from '../../examples/verulink-roundtrip.js'

const mocks = vi.hoisted(() => ({
  aleo: 'aleo1roundtrip',
  bsc: '0x1111111111111111111111111111111111111111',
  quote: vi.fn(),
  execute: vi.fn(),
  recover: vi.fn(),
}))

vi.mock('@provablehq/veil-core', () => ({
  createPublicClient: () => ({}),
  http: () => ({}),
  readContract: async () => '100000000u64',
}))
vi.mock('@provablehq/veil-aleo-sdk', () => ({
  loadNetwork: async () => ({
    createAleoClient: () => ({ publicClient: {}, walletClient: { account: { address: mocks.aleo } } }),
  }),
}))
vi.mock('@provablehq/aleo-bridge-sdk', () => ({
  createAleoClient: () => ({ family: 'aleo', publicClient: {} }),
  createEvmClient: () => ({
    family: 'evm',
    publicClient: { getBalance: async () => 10000000000000000n },
    walletClient: { getAddress: async () => mocks.bsc },
  }),
  evmHttp: () => ({}),
  evmPrivateKey: () => ({}),
  createBridgeClient: () => ({ quote: mocks.quote, execute: mocks.execute, recover: mocks.recover }),
  createBridgeCheckpoint: vi.fn(),
}))

describe('Verulink roundtrip preflight', () => {
  let directory: string
  let path: string
  const stopped = new Error('Stopped at submission boundary')

  beforeEach(async () => {
    vi.resetAllMocks()
    directory = await mkdtemp(join(tmpdir(), 'veil-verulink-roundtrip-'))
    path = join(directory, 'state.json')
    vi.stubEnv('ALEO_ADDRESS', mocks.aleo)
    vi.stubEnv('BSC_ADDRESS', mocks.bsc)
    vi.stubEnv('ALEO_PRIVATE_KEY', 'test-only')
    vi.stubEnv('EVM_PRIVATE_KEY', 'test-only')
    vi.stubEnv('ALEO_PROVING_MODE', 'delegated')
    vi.stubEnv('AMOUNT', '20')
    vi.stubEnv('EXECUTE_BRIDGE', 'I_UNDERSTAND_THIS_MOVES_REAL_FUNDS')
    vi.stubEnv('ROUNDTRIP_STATE_FILE', path)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    mocks.execute.mockRejectedValue(stopped)
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    await rm(directory, { recursive: true, force: true })
  })

  it('rejects an insufficient return amount before submitting or recording a source attempt', async () => {
    vi.stubEnv('AMOUNT', '10.01001')
    mocks.quote.mockResolvedValueOnce({ plan: { amountOut: '10' } })
      .mockRejectedValueOnce(new Error('Return amount is below the net minimum'))

    await expect(runVerulinkRoundtrip()).rejects.toThrow('below the net minimum')

    expect(mocks.quote).toHaveBeenLastCalledWith({
      source: { chain: 'bsc', asset: 'aleo' }, destination: { chain: 'aleo', asset: 'aleo' },
      amount: '10', sender: mocks.bsc, recipient: mocks.aleo,
    })
    expect(mocks.execute).not.toHaveBeenCalled()
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(path + '.lock', 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('validates the estimated return and persists the attempt before submitting the outbound plan', async () => {
    const outbound = { amountOut: '19.98' }
    mocks.quote.mockResolvedValueOnce({ plan: outbound }).mockResolvedValueOnce({ plan: { amountOut: '19.96002' } })
    mocks.execute.mockImplementationOnce(async ({ plan }) => {
      expect(plan).toBe(outbound)
      expect(mocks.quote).toHaveBeenCalledTimes(2)
      expect(mocks.quote).toHaveBeenLastCalledWith({
        source: { chain: 'bsc', asset: 'aleo' }, destination: { chain: 'aleo', asset: 'aleo' },
        amount: '19.98', sender: mocks.bsc, recipient: mocks.aleo,
      })
      expect(JSON.parse(await readFile(path, 'utf8')).legs[0].sourceAttempted).toBe(true)
      throw stopped
    })

    await expect(runVerulinkRoundtrip()).rejects.toBe(stopped)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('recovers an existing outbound checkpoint and quotes the return using the verified received amount', async () => {
    const checkpoint = { version: 1 }
    await writeFile(path, JSON.stringify({
      version: 1, aleo: mocks.aleo, bsc: mocks.bsc, amount: '20',
      legs: [{ amount: '20', sourceAttempted: true, checkpoint }],
    }))
    mocks.recover.mockResolvedValue({
      next: 'done', receipt: { status: 'COMPLETED', protocolState: { packet: { amount: '19000000' } } },
    })
    mocks.quote.mockResolvedValue({ plan: { amountOut: '18.981' } })

    await expect(runVerulinkRoundtrip()).rejects.toBe(stopped)

    expect(mocks.recover).toHaveBeenCalledWith({ checkpoint })
    expect(mocks.quote).toHaveBeenCalledExactlyOnceWith({
      source: { chain: 'bsc', asset: 'aleo' }, destination: { chain: 'aleo', asset: 'aleo' },
      amount: '19', sender: mocks.bsc, recipient: mocks.aleo,
    })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })
})
