import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createWalletClient, memoryRecordInventoryStore, parseRecord,
  type ExecuteOptions, type RecordInventoryStore, type OwnedRecord } from '@provablehq/veil-core'
import { swap } from '../../../src/actions/swap/swap.js'
import { swapMultiHop } from '../../../src/actions/swap/swapMultiHop.js'
import { executionQuote } from '../../../src/actions/swap/internal.js'
import { clearRouteCache, programToTokenId } from '../../../src/utils/routing.js'
import { EMPTY_MERKLE_PROOFS } from '../../../src/utils/proofs.js'

const owner = 'aleo1owner'
const scope = JSON.stringify(['testnet', owner])
const tokenA = programToTokenId('token_a')
const tokenB = programToTokenId('token_b')
const tokenC = programToTokenId('token_c')
const wrappedA = programToTokenId('wrapped_a')
const plaintext = (nonce: number, amount = 100n) => `{ owner: ${owner}.private, amount: ${amount}u128.private, _nonce: ${nonce}group.public }`
const records = (count: number): OwnedRecord[] => Array.from({ length: count }, (_, index) => ({
  programName: 'token_a.aleo', recordName: 'Token', spent: false, recordPlaintext: plaintext(index + 1),
}))

/** Forces every first attempt to reach acquisition before any writer can win. */
function barrier(count: number) {
  let remaining = count
  let release!: () => void
  const ready = new Promise<void>(resolve => { release = resolve })
  return async () => { if (--remaining === 0) release(); await ready }
}

/** Keeps selection, input construction, acquisition and lifecycle handling real; replaces only chain/scanner/prover I/O. */
function world(options: { count?: number; racers?: number; wrapped?: boolean; enabled?: boolean } = {}) {
  const backing = memoryRecordInventoryStore()
  const firstAttempts = barrier(options.racers ?? 1)
  const attempts: string[][] = []
  let onAcquire: (() => Promise<void>) | undefined
  let onProve: ((options: ExecuteOptions) => Promise<void>) | undefined
  const store: RecordInventoryStore = {
    ...backing,
    async acquire(entry) {
      attempts.push([...entry.records])
      if (attempts.length <= (options.racers ?? 1)) await firstAttempts()
      await onAcquire?.()
      return backing.acquire(entry)
    },
  }
  const proved: ExecuteOptions[] = []
  const request = async ({ method, params }: any) => {
    if (method === 'getLatestHeight' || method === 'getBlockNumber') return 1000n
    if (method === 'getMappingValue') {
      if (params.mapping === 'pools') {
        const a = params.key === '1001field' ? (options.wrapped ? wrappedA : tokenA) : tokenB
        const b = params.key === '1001field' ? tokenB : tokenC
        return `{ token0: ${a}, token1: ${b}, fee: 3000u16, enabled: true }`
      }
      if (params.mapping === 'slots') return '{ tick: 0i32, tick_spacing: 60u32, sqrt_price: { hi: 1u128, lo: 0u128 }, fee_protocol: 0u8, liquidity: 10000000u128, fee_growth_global0_x_128: { hi: 0u128, lo: 0u128 }, fee_growth_global1_x_128: { hi: 0u128, lo: 0u128 }, max_liquidity_per_tick: 10000000u128, protocol_fees0: 0u128, protocol_fees1: 0u128, next_init_below: -60i32, next_init_above: 60i32 }'
      if (params.mapping === 'from_wrapper_token_id') return options.wrapped && params.key === wrappedA ? tokenA : null
      return null
    }
    throw new Error(`Unexpected chain method ${method}`)
  }
  const scan = vi.fn(async () => records(options.count ?? 6))
  const client = createWalletClient({
    account: { type: 'local', source: 'test', address: owner, privateKey: 'test', viewKey: 'test', sign: vi.fn(), signMessage: vi.fn() },
    transport: { config: { key: 'test', name: 'test', type: 'custom', network: 'testnet', request }, request },
    recordManagement: { enabled: options.enabled ?? true, store },
    recordProvider: { requestRecords: scan, setAccount() {} },
    proving: { mode: 'local', execute: async (options: ExecuteOptions) => {
      proved.push(options)
      const sequence = proved.length
      await onProve?.(options)
      const transactionId = `at1${sequence}`
      await options.onProgress?.({ type: 'transaction-confirmed', transactionId })
      return { transactionId, transitions: [], outputs: [`${sequence}field`] }
    } },
  })
  const params = (index = 1) => ({
    poolKey: '1001field', poolKeys: ['1001field', '1002field'], tokenInId: options.wrapped ? wrappedA : tokenA,
    amountIn: 10n, expectedOut: 10n, nonce: BigInt(index), imports: { 'token_a.aleo': 'program token_a.aleo;' },
    blindedIdentity: { blindingFactor: `${index}field`, blindedAddress: `aleo1identity${index}` },
    proofs: async () => EMPTY_MERKLE_PROOFS,
  })
  return { client, store, backing, attempts, proved, scan, params,
    onAcquire: (fn: () => Promise<void>) => { onAcquire = fn },
    onProve: (fn: (options: ExecuteOptions) => Promise<void>) => { onProve = fn } }
}
const inputNonce = (options: ExecuteOptions) => parseRecord(options.inputs.find(input => input.includes('_nonce'))!).nonce
const hold = (store: RecordInventoryStore, id: string) => store.acquire({ scope, records: [id], program: 'token_a.aleo', function: 'join', status: 'reserved', accountType: 'local', createdAt: 1 })
beforeEach(() => clearRouteCache())

for (const [name, action] of [['swap', swap], ['swapMultiHop', swapMultiHop]] as const) {
  describe(`${name} concurrent input selection`, () => {
    it.each([false, true])('reselects six distinct inputs when all first acquisitions race (wrapped=%s)', async wrapped => {
      const w = world({ racers: 6, wrapped })
      const results = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => action(w.client, w.params(index + 1))))
      expect(results.map(result => result.status)).toEqual(Array(6).fill('fulfilled'))
      expect(w.attempts.slice(0, 6)).toEqual(Array.from({ length: 6 }, () => ['1group']))
      expect(w.proved.map(inputNonce).sort()).toEqual(['1group', '2group', '3group', '4group', '5group', '6group'])
      expect(w.scan).toHaveBeenCalledTimes(6)
      expect((await w.store.list(scope)).map(entry => entry.status)).toEqual(Array(6).fill('confirmed'))
      expect(w.proved.every(call => call.functionName === (wrapped
        ? name === 'swap' ? 'swap_from_wrapped' : 'swap_mh_from_wrapped'
        : name === 'swap' ? 'swap' : 'swap_multi_hop'))).toBe(true)
      for (const call of w.proved) {
        const nonceIndex = call.inputs.length - (name === 'swap' ? 4 : 2)
        const identityIndex = wrapped ? 2 : name === 'swap' ? 1 : 0
        expect(call.inputs[identityIndex]).toBe(call.inputs[nonceIndex]!.replace('u64', 'field'))
        expect(call.inputs).toContain('10u128')
        expect(call.programImports).toEqual({ 'token_a.aleo': 'program token_a.aleo;' })
      }
    })

    it('stops after its finite candidates are reserved, even when the scanner stays stale', async () => {
      const w = world({ count: 2 })
      w.onAcquire(async () => { await hold(w.backing, '1group'); await hold(w.backing, '2group') })
      await expect(action(w.client, w.params())).rejects.toMatchObject({ name: 'RecordReservationConflictError' })
      expect(w.attempts).toEqual([['1group'], ['2group']])
      expect(w.proved).toHaveLength(0)
      expect(w.scan).toHaveBeenCalledOnce()
    })

    it('keeps explicitly supplied records fixed on contention', async () => {
      const w = world()
      await hold(w.backing, '1group')
      await expect(action(w.client, { ...w.params(), tokenRecord: plaintext(1) })).rejects.toThrow('reserved or spent')
      expect(w.scan).not.toHaveBeenCalled()
      expect(w.attempts).toEqual([['1group']])
      expect(w.proved).toHaveLength(0)
    })

    it.each(['before proving', 'prepared', 'submitted', 'confirmed'])('does not retry errors %s', async stage => {
      const w = world()
      w.onProve(async options => {
        if (stage !== 'before proving') await options.onProgress?.({ type: 'transaction-prepared', transactionId: 'at1uncertain', transaction: { id: 'at1uncertain', type: 'execute' } } as any)
        if (stage === 'submitted' || stage === 'confirmed') await options.onProgress?.({ type: 'transaction-submitted', transactionId: 'at1uncertain' })
        if (stage === 'confirmed') await options.onProgress?.({ type: 'transaction-confirmed', transactionId: 'at1uncertain' })
        throw new Error('Execution failed')
      })
      await expect(action(w.client, w.params())).rejects.toThrow('Execution failed')
      expect(w.proved.map(inputNonce)).toEqual(['1group'])
      expect(w.attempts).toHaveLength(1)
      expect((await w.store.list(scope))[0]?.status).toBe(stage === 'before proving' ? 'cancelled' : stage)
    })

    it.each(['account', 'network'])('refuses to retry after the %s changes', async change => {
      const w = world()
      w.onAcquire(async () => {
        await hold(w.backing, '1group')
        if (change === 'account') (w.client.account as any).address = 'aleo1other'
        else (w.client.transport.config as any).network = 'mainnet'
      })
      await expect(action(w.client, w.params())).rejects.toThrow(/changed/)
      expect(w.proved).toHaveLength(0)
      expect(w.attempts).toHaveLength(1)
    })

    it('preserves accepted terms and identity when caller objects change during contention', async () => {
      const w = world()
      const params = w.params(7)
      w.onAcquire(async () => {
        await hold(w.backing, '1group')
        params.amountIn = 999n
        params.expectedOut = 999n
        params.blindedIdentity.blindingFactor = '999field'
        params.imports['token_a.aleo'] = 'changed'
      })
      const handle = await action(w.client, params)
      expect(handle.amountIn).toBe(10n)
      expect(handle.blindingFactor).toBe('7field')
      expect(w.proved.map(inputNonce)).toEqual(['2group'])
      expect(w.proved[0]!.inputs).not.toContain('999u128')
      expect(w.proved[0]!.programImports).toEqual({ 'token_a.aleo': 'program token_a.aleo;' })
    })

    it('does not retry a nested reservation conflict once its own inputs were acquired', async () => {
      const w = world()
      w.onProve(async options => {
        // A caller callback can perform another managed action; its conflict
        // says nothing about whether the outer spend reached the network.
        await w.client.executeContract({ program: 'token_a.aleo', function: 'join', inputs: [options.inputs.find(input => input.includes('_nonce'))!] })
      })
      await expect(action(w.client, w.params())).rejects.toMatchObject({
        message: 'Record spending failed after acquiring inputs', cause: { name: 'RecordReservationConflictError' },
      })
      expect(w.proved).toHaveLength(1)
      expect(w.attempts).toEqual([['1group'], ['1group']])
    })

    it('retains legacy uncoordinated selection when management is disabled', async () => {
      const w = world({ enabled: false })
      await Promise.all([action(w.client, w.params(1)), action(w.client, w.params(2))])
      expect(w.proved.map(inputNonce)).toEqual(['1group', '1group'])
      expect(w.attempts).toHaveLength(0)
    })
  })
}

it('checks quote expiration again after a conflicting acquisition without proving a replacement', async () => {
  const w = world()
  const now = Date.now()
  const params = { ...w.params(), [executionQuote]: {
    version: 1, network: 'testnet', program: 'shield_swap.aleo', quotedAt: now, expiresAt: now + 30_000,
    amountIn: 10n, expectedOut: 10n, minOut: 9n, slippageBps: 1000, protocolRevision: 1,
    from: { id: tokenA, symbol: 'A', decimals: 6 }, to: { id: tokenB, symbol: 'B', decimals: 6 },
    hops: [{ poolKey: '1001field', tokenInId: tokenA, tokenOutId: tokenB }],
  } }
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  w.onAcquire(async () => { await hold(w.backing, '1group'); clock.mockReturnValue(now + 30_001) })
  try {
    await expect(swap(w.client, params)).rejects.toThrow('Quote expired')
    expect(w.attempts).toHaveLength(1)
    expect(w.proved).toHaveLength(0)
  } finally { clock.mockRestore() }
})
