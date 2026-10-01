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
