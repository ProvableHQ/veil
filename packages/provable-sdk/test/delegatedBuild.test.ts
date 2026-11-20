import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as testnetSdk from '@provablehq/sdk/testnet.js'
import { loadNetwork, type AleoSdk } from '../src/index.js'

describe('delegated transaction building', () => {
  let aleo: AleoSdk

  beforeAll(async () => {
    aleo = await loadNetwork('testnet')
  }, 60_000)

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('includes the dynamic token and its transitive imports when proving a router join', async () => {
    const router = 'program test_aj_arc20_2_15.aleo;'
    const token = 'import helper.aleo; program test_usdcx_stablecoin.aleo;'
    const helper = 'program helper.aleo;'
    vi.spyOn(testnetSdk.AleoNetworkClient.prototype, 'getProgram').mockImplementation(async (name) =>
      name === 'test_aj_arc20_2_15.aleo' ? router : token)
    vi.spyOn(testnetSdk.AleoNetworkClient.prototype, 'getProgramImports').mockImplementation(async (source) =>
      source === token ? { 'helper.aleo': helper } : {})
    const request = vi.spyOn(testnetSdk.ProgramManager.prototype, 'provingRequest').mockResolvedValue({ encrypted: true } as never)
    vi.spyOn(testnetSdk.AleoNetworkClient.prototype, 'submitProvingRequestSafe').mockResolvedValue({ ok: true,
      data: { transaction: { id: 'at1batch' }, broadcast_result: { status: 'Skipped' } } } as never)
    const config = aleo.createProvingConfig({ mode: 'delegated', networkUrl: 'https://node.example',
      proverUrl: 'https://prover.example', account: aleo.generateAccount() })
    await config.buildTransaction!({ programName: 'test_aj_arc20_2_15.aleo', functionName: 'join_3',
      inputs: ["'test_usdcx_stablecoin'", 'record-a', 'record-b', 'record-c'], imports: ['test_usdcx_stablecoin.aleo'] })
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ broadcast: false,
      programImports: { 'test_usdcx_stablecoin.aleo': token, 'helper.aleo': helper } }))
  })

  it('applies clientHeaders to the node and prover clients on Provable hosts only', async () => {
    vi.spyOn(testnetSdk.ProgramManager.prototype, 'provingRequest').mockResolvedValue({ encrypted: true } as never)
    vi.spyOn(testnetSdk.AleoNetworkClient.prototype, 'submitProvingRequestSafe').mockResolvedValue({ ok: true,
      data: { transaction: { id: 'at1tagged' }, broadcast_result: { status: 'Skipped' } } } as never)
    const managerHeader = vi.spyOn(testnetSdk.ProgramManager.prototype, 'setHeader')
    const clientHeader = vi.spyOn(testnetSdk.AleoNetworkClient.prototype, 'setHeader')
    const build = (networkUrl: string, proverUrl: string) => aleo.createProvingConfig({ mode: 'delegated', networkUrl,
      proverUrl, account: aleo.generateAccount() }).buildTransaction!({ programName: 'credits.aleo',
      functionName: 'transfer_public', inputs: ['aleo1recipient', '1u64'], clientHeaders: { 'X-Aleo-Bridge': 'action=execute' } })

    await build('https://node.example', 'https://prover.example')
    expect(managerHeader).not.toHaveBeenCalled()
    expect(clientHeader).not.toHaveBeenCalled()

    await build('https://edge.provable.com/api/v2', 'https://edge.provable.com/api/prove')
    expect(managerHeader).toHaveBeenCalledWith('X-Aleo-Bridge', 'action=execute')
    expect(clientHeader).toHaveBeenCalledWith('X-Aleo-Bridge', 'action=execute')
  })

  it('labels the prover, broadcast, and confirmation requests of a delegated execute', async () => {
    const transaction = { type: 'execute', id: 'at1tagged', execution: { transitions: [] } }
    vi.spyOn(testnetSdk.ProgramManager.prototype, 'provingRequest').mockResolvedValue({ encrypted: true } as never)
    vi.spyOn(testnetSdk.AleoNetworkClient.prototype, 'submitProvingRequestSafe').mockResolvedValue({ ok: true,
      data: { transaction } } as never)
    const managerHeader = vi.spyOn(testnetSdk.ProgramManager.prototype, 'setHeader')
    const clientHeader = vi.spyOn(testnetSdk.AleoNetworkClient.prototype, 'setHeader')
    const sent: Array<{ url: string; header: string | undefined }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      sent.push({ url, header: init.headers['X-Aleo-Bridge'] })
      const body = url.endsWith('/transaction/broadcast') ? 'at1tagged' : { status: 'accepted', transaction }
      return { ok: true, json: async () => body }
    }))
    const config = aleo.createProvingConfig({ mode: 'delegated', networkUrl: 'https://edge.provable.com/api/v2',
      proverUrl: 'https://edge.provable.com/api/prove', account: aleo.generateAccount() })

    const result = await config.execute!({ programName: 'credits.aleo', functionName: 'transfer_public',
      inputs: ['aleo1recipient', '1u64'], fee: 0n, programSource: 'program credits.aleo;', onProgress() {},
      clientHeaders: { 'X-Aleo-Bridge': 'action=execute' } })

    expect(result.transactionId).toBe('at1tagged')
    expect(managerHeader).toHaveBeenCalledWith('X-Aleo-Bridge', 'action=execute')
    expect(clientHeader).toHaveBeenCalledWith('X-Aleo-Bridge', 'action=execute')
    expect(sent.map(({ url }) => url.split('/testnet/')[1])).toEqual(['transaction/broadcast', 'transaction/confirmed/at1tagged'])
    expect(sent.every(({ header }) => header === 'action=execute')).toBe(true)
  })

  it('asks the prover not to broadcast and reports each proving boundary', async () => {
    const transaction = { type: 'execute', id: 'at1proved', fee: {} }
    const provingRequest = vi.spyOn(testnetSdk.ProgramManager.prototype, 'provingRequest')
      .mockResolvedValue({ encrypted: true } as never)
    vi.spyOn(testnetSdk.AleoNetworkClient.prototype, 'submitProvingRequestSafe')
      .mockResolvedValue({
        ok: true,
        data: { transaction, broadcast_result: { status: 'Skipped' } },
      } as never)
    const events: unknown[] = []
    const config = aleo.createProvingConfig({
      mode: 'delegated',
      networkUrl: 'https://node.example',
      proverUrl: 'https://prover.example',
      account: aleo.generateAccount(),
    })

    const result = await config.buildTransaction!({
      programName: 'credits.aleo',
      functionName: 'transfer_public',
      inputs: ['aleo1recipient', '1u64'],
      onProgress(event) { events.push(event) },
    })

    expect(result).toBe(transaction)
    expect(provingRequest).toHaveBeenCalledWith(expect.objectContaining({
      broadcast: false,
      useFeeMaster: false,
    }))
    expect(events).toEqual([
      { type: 'request-built' },
      { type: 'prover-submitted' },
      { type: 'prover-returned', transactionId: 'at1proved' },
    ])
  })

  it('awaits the durable checkpoint and never broadcasts when it fails', async () => {
    const transaction = { type: 'execute', id: 'at1prepared', fee: {} }
    const request = vi.spyOn(testnetSdk.ProgramManager.prototype, 'provingRequest')
      .mockResolvedValue({ encrypted: true } as never)
    vi.spyOn(testnetSdk.AleoNetworkClient.prototype, 'submitProvingRequestSafe')
      .mockResolvedValue({ ok: true, data: { transaction, broadcast_result: { status: 'Skipped' } } } as never)
    const fetch = vi.fn(() => { throw new Error('must not broadcast') })
    vi.stubGlobal('fetch', fetch)
    const config = aleo.createProvingConfig({ mode: 'delegated', networkUrl: 'https://node.example',
      proverUrl: 'https://prover.example', account: aleo.generateAccount() })
    const events: unknown[] = []
    await expect(config.execute!({ programName: 'credits.aleo', functionName: 'join', inputs: [], fee: 0n,
      async onProgress(event) { events.push(event); throw new Error('disk full') },
    })).rejects.toThrow('disk full')
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ broadcast: false }))
    expect(events).toEqual([{ type: 'transaction-prepared', transactionId: transaction.id, transaction }])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports a failed delegated broadcast without polling for confirmation', async () => {
    const transaction = { type: 'execute', id: 'at1notbroadcast', fee: {} }
    vi.spyOn(testnetSdk.ProgramManager.prototype, 'provingRequest')
      .mockResolvedValue({ encrypted: true } as never)
    vi.spyOn(testnetSdk.AleoNetworkClient.prototype, 'submitProvingRequestSafe')
      .mockResolvedValue({
        ok: true,
        data: {
          transaction,
          broadcast_result: {
            status: 'Failed',
            message: 'upstream node did not accept the transaction',
          },
        },
      } as never)
    const config = aleo.createProvingConfig({
      mode: 'delegated',
      networkUrl: 'https://node.example',
      proverUrl: 'https://prover.example',
      account: aleo.generateAccount(),
      confirmationTimeout: 0,
    })

    await expect(config.execute!({
      programName: 'credits.aleo',
      functionName: 'transfer_public',
      inputs: ['aleo1recipient', '1u64'],
      fee: 0n,
    })).rejects.toMatchObject({
      name: 'BroadcastError',
      message: expect.stringContaining('upstream node did not accept the transaction'),
    })
  })
})
