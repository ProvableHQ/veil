import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as sdk from '@provablehq/sdk/testnet.js'
import { loadNetwork, createDevnodeClient, type AleoSdk } from '../src/index.js'

let aleo: AleoSdk
beforeAll(async () => { aleo = await loadNetwork('testnet') }, 60_000)
afterEach(() => vi.restoreAllMocks())

// Exercise Veil's real adapter while replacing only WASM proving and network I/O.
// The reserved record must reach each SDK entry point unchanged.
describe('reserved private fee record adapter', () => {
  it.each(['local', 'delegated'] as const)('passes the selected fee record to %s build and execute', async mode => {
    const tx = { id: 'at1fee', type: 'execute', execution: { transitions: [] } }
    const build = vi.spyOn(sdk.ProgramManager.prototype, 'buildExecutionTransaction').mockResolvedValue({ toString: () => JSON.stringify(tx) } as never)
    const request = vi.spyOn(sdk.ProgramManager.prototype, 'provingRequest').mockResolvedValue({ encrypted: true } as never)
    vi.spyOn(sdk.AleoNetworkClient.prototype, 'submitProvingRequestSafe').mockResolvedValue({ ok: true, data: { transaction: tx } } as never)
    const config = aleo.createProvingConfig({ mode, networkUrl: 'https://node.example', useFeeMaster: true, account: aleo.generateAccount() })
    const options = { programName: 'token.aleo', functionName: 'transfer_private', inputs: [], privateFee: true, feeRecord: 'selected-record' }
    await config.buildTransaction!(options)
    await expect(config.execute!({ ...options, fee: 0n, onProgress() { throw new Error('checkpoint stops broadcast') } })).rejects.toThrow('checkpoint stops broadcast')
    const calls = mode === 'delegated' ? request.mock.calls : build.mock.calls
    expect(calls).toHaveLength(2)
    for (const [params] of calls) expect(params).toMatchObject({ feeRecord: 'selected-record', privateFee: true,
      ...(mode === 'delegated' ? { useFeeMaster: false } : {}) })
  })
  it('estimates base fees in microcredits and resolves dynamic imports', async () => {
    const estimate = vi.spyOn(sdk.ProgramManager.prototype, 'estimateExecutionFee').mockResolvedValue(12345n)
    vi.spyOn(sdk.AleoNetworkClient.prototype, 'getProgram').mockImplementation(async name => `program ${name};`)
    vi.spyOn(sdk.AleoNetworkClient.prototype, 'getProgramImports').mockResolvedValue({})
    const config = aleo.createProvingConfig({ mode: 'delegated', networkUrl: 'https://node.example' })
    expect(await config.estimateExecutionFee!({ programName: 'router.aleo', functionName: 'join_3', imports: ['token.aleo'] })).toBe(12345n)
    expect(estimate).toHaveBeenCalledWith(expect.objectContaining({ programName: 'router.aleo', functionName: 'join_3', imports: { 'token.aleo': 'program token.aleo;' } }))
  })
  it('passes the selected fee record to the devnode builder', async () => {
    const build = vi.spyOn(sdk.ProgramManager.prototype, 'buildDevnodeExecutionTransaction').mockResolvedValue({ toString: () => JSON.stringify({ id: 'at1devnode' }) } as never)
    const { walletClient } = createDevnodeClient()
    await walletClient.proving!.buildTransaction!({ programName: 'credits.aleo', functionName: 'join', inputs: [], privateFee: true, feeRecord: 'selected-record' } as any)
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ feeRecord: 'selected-record', privateFee: true }))
  })
})
