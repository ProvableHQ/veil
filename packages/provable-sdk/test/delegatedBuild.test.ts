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
})
