import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { shieldSwapActions } from '../../src/decorators/shieldSwapActions.js'
import { fileBlindedIdentityStore } from '../../src/node.js'
import { reconcileSwapHistory } from '../../src/actions/blinding/reconcileSwapHistory.js'
import { syncBlindedIdentities } from '../../src/actions/blinding/syncBlindedIdentities.js'
import type { BlindedIdentityRecord, BlindedIdentityStore } from '../../src/utils/blinding/store.js'
import type { SwapHandle } from '../../src/actions/swap/swap.js'

/**
 * The blinded-identity store against the live testnet deployment, on disk.
 *
 * Walks one identity through every status the chain can put it in — `reserved`
 * before the swap lands, `swapped` while its output waits in `swap_outputs`,
 * `claimed` once the claim removes that entry — and asserts each transition is
 * what `syncBlindedIdentities` reads back from chain rather than what the local
 * calls assumed. Then throws the store away and rebuilds it from chain history
 * with `reconcileSwapHistory`, which is the recovery path a bot needs after
 * losing its file.
 *
 * The store is a fresh temp file per run, so reservation starts cold and the
 * counter scan is exercised. Every assertion about persistence reads through a
 * second store instance on the same path, because a store that only ever agreed
 * with itself in memory would pass while writing nothing.
 *
 * Spends real testnet balances: one swap and one claim. Requirements (skipped
 * when absent):
 *   VEIL_INTEGRATION=1
 *   VEIL_E2E_PRIVATE_KEY   funded testnet account
 *   ALEO_CONSUMER_ID, ALEO_DPS_API_KEY   Provable API credentials
 *
 *   VEIL_INTEGRATION=1 npx vitest run packages/shield-swap/test/integration/blindedIdentityStore.e2e.test.ts
 */

const PRIVATE_KEY = process.env.VEIL_E2E_PRIVATE_KEY
const CONSUMER_ID = process.env.ALEO_CONSUMER_ID
const API_KEY = process.env.ALEO_DPS_API_KEY
const RUN = process.env.VEIL_INTEGRATION === '1' && !!PRIVATE_KEY && !!CONSUMER_ID && !!API_KEY
const TX = 600_000

type Token = { address: string; symbol: string; amm_token_program?: string | null }
type Pool = { key: string; token0: string; token1: string }

describe.runIf(RUN)('blinded identity store on testnet', () => {
  let client: ReturnType<ReturnType<typeof shieldSwapActions>> &
    Awaited<ReturnType<Awaited<ReturnType<typeof loadNetwork>>['createAleoClient']>>['walletClient']
  let storePath: string
  let store: BlindedIdentityStore

  const state: {
    pool?: Pool
    tokenInId?: string
    amountIn?: bigint
    imports?: Record<string, string>
    identity?: BlindedIdentityRecord
    handle?: SwapHandle
  } = {}

  /** Reads the file through a second instance, so only what reached disk counts. */
  const fromDisk = async () => fileBlindedIdentityStore(storePath).load()

  /** Waits for the swap's finalize write, which lands after the tx confirms. */
  const waitForOutput = async (swapId: string) => {
    for (let i = 0; i < 40; i++) {
      if ((await client.getSwapOutput({ swapId })) !== null) return true
      await new Promise((r) => setTimeout(r, 3_000))
    }
    return false
  }

  // The lifecycle is sequential: every step reads what the previous one wrote,
  // so after a failure the rest would spend fees to assert against state that
  // never happened.
  let aborted: string | undefined
  afterEach((ctx) => {
    if (ctx.task.result?.state === 'fail') aborted ??= ctx.task.name
  })
  beforeEach(() => {
    if (aborted) throw new Error(`aborted: "${aborted}" failed, and the rest of the lifecycle depends on it`)
  })

  beforeAll(async () => {
    storePath = join(await mkdtemp(join(tmpdir(), 'veil-blinded-e2e-')), 'blinded.json')
    store = fileBlindedIdentityStore(storePath)

    const aleo = await loadNetwork('testnet')
    const { walletClient } = aleo.createAleoClient({
      privateKey: PRIVATE_KEY!,
      networkUrl: 'https://api.provable.com/v2',
      consumerId: CONSUMER_ID,
      apiKey: API_KEY,
      records: aleo.createRemoteScanner(),
      confirmationTimeout: 400_000,
    })
    client = walletClient.extend(shieldSwapActions({ api: {}, blindedIdentities: store })) as typeof client
    await client.authenticateShieldSwap()

    const tokens = (await client.api.getTokens()).data as Token[]
    const pools = (await client.api.getPools({ limit: 50 })).data as Pool[]
    const balances = await client.getBalances()
    const held = (id: string) => balances[id]?.private ?? 0n

    const funded = pools.find((p) => held(p.token0) > 0n || held(p.token1) > 0n)
    if (funded) {
      state.pool = funded
      state.tokenInId = held(funded.token0) > 0n ? funded.token0 : funded.token1
      // A thousandth of the balance: enough to swap, small enough that repeated
      // runs do not drain the account.
      state.amountIn = held(state.tokenInId) / 1000n
      state.imports = await client.resolveDexImports({
        tokenPrograms: [state.pool.token0, state.pool.token1].map(
          (id) => tokens.find((t) => t.address === id)!.amm_token_program!,
        ),
      })
    }
  }, 180_000)

  it('reserves an identity from a cold store and writes it to disk', async () => {
    expect(state.pool, 'no live pool is funded for this account').toBeTruthy()
    expect(await fromDisk(), 'the store should start empty').toEqual([])

    state.identity = await client.reserveBlindedIdentity()
    expect(state.identity.status).toBe('reserved')
    // Cold start scans from 0, and the chain decides which counters are free —
    // so the counter is whatever the account has not used, not necessarily 0.
    expect(state.identity.counter).toBeGreaterThanOrEqual(0)
    expect(state.identity.blindedAddress).toMatch(/^aleo1/)

    const persisted = await fromDisk()
    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({
      blindedAddress: state.identity.blindedAddress,
      counter: state.identity.counter,
      status: 'reserved',
    })
    // The reservation is on chain-unused ground, which is what makes it safe.
    expect(await client.isBlindedAddressUsed({ address: state.identity.blindedAddress })).toBe(false)
  }, 120_000)

  it('stays reserved while the swap is unconfirmed, then reads swapped from chain', async () => {
    // Before the swap: the address is not in the mapping, so no promotion is
    // possible however the local calls went.
    const before = await client.syncBlindedIdentities()
    expect(before[0]!.status).toBe('reserved')

    state.handle = await client.swap({
      poolKey: state.pool!.key,
      tokenInId: state.tokenInId!,
      amountIn: state.amountIn!,
      slippageBps: 500,
      imports: state.imports,
      blindedIdentity: state.identity!,
    })
    expect(state.handle.swapId).toBeTruthy()
    await client.recordBlindedSwap({
      blindedAddress: state.identity!.blindedAddress,
      swapId: state.handle.swapId!,
    })
    expect((await fromDisk())[0]!.swapId).toBe(state.handle.swapId)

    expect(await waitForOutput(state.handle.swapId!)).toBe(true)
    const settled = await client.syncBlindedIdentities()
    // The address is used and its output is still in the mapping: unclaimed.
    expect(settled[0]!.status).toBe('swapped')
    expect((await fromDisk())[0]!.status).toBe('swapped')
  }, TX)

  it('reads claimed once the claim removes the output', async () => {
    const claim = await client.claimSwapOutput({ handle: state.handle!, imports: state.imports })
    expect(claim.amountOut).toBeGreaterThan(0n)

    // The claim deletes swap_outputs[swapId], which is exactly what separates
    // claimed from swapped — and the mapping write propagates asynchronously.
    let status = ''
    for (let i = 0; i < 20 && status !== 'claimed'; i++) {
      status = (await client.syncBlindedIdentities())[0]!.status
      if (status !== 'claimed') await new Promise((r) => setTimeout(r, 3_000))
    }
    expect(status).toBe('claimed')
    expect(await client.getSwapOutput({ swapId: state.handle!.swapId! })).toBeNull()
    expect((await fromDisk())[0]!.status).toBe('claimed')
  }, TX)

  it('rebuilds a lost store from chain history', async () => {
    // What a bot has after losing its file: the identity is derivable again from
    // the view key and counter, but the swap id it settled is not recorded
    // anywhere the account can read — the claim consumed the mapping entry.
    const recoveredPath = join(await mkdtemp(join(tmpdir(), 'veil-blinded-lost-')), 'blinded.json')
    const recovered = fileBlindedIdentityStore(recoveredPath)
    await recovered.save([
      {
        counter: state.identity!.counter,
        blindingFactor: state.identity!.blindingFactor,
        blindedAddress: state.identity!.blindedAddress,
        status: 'reserved',
      },
    ])

    const result = await reconcileSwapHistory(client, { store: recovered, maxPages: 20 })
    expect(result.claims.map((c) => c.blindedAddress)).toContain(state.identity!.blindedAddress)
    const claim = result.claims.find((c) => c.blindedAddress === state.identity!.blindedAddress)!
    // The swap id came back out of the claim call's inputs, matching the one the
    // swap handed us before the store lost it.
    expect(claim.swapId).toBe(state.handle!.swapId)
    expect(claim.amountOut).toBeGreaterThan(0n)
    expect(claim.transactionId).toMatch(/^at1/)

    const persisted = await fileBlindedIdentityStore(recoveredPath).load()
    expect(persisted[0]).toMatchObject({ status: 'claimed', swapId: state.handle!.swapId })

    // Sync alone could not have done this: with the mapping entry gone it sees
    // only a consumed address, and without the swap id cannot tell which swap.
    const syncOnly = fileBlindedIdentityStore(join(await mkdtemp(join(tmpdir(), 'veil-blinded-sync-')), 's.json'))
    // Built field by field rather than spread with `swapId: undefined`: the
    // scenario is a record that never carried a swap id, not one carrying an
    // undefined value.
    await syncOnly.save([
      {
        counter: state.identity!.counter,
        blindingFactor: state.identity!.blindingFactor,
        blindedAddress: state.identity!.blindedAddress,
        status: 'reserved',
      },
    ])
    const synced = await syncBlindedIdentities(client, { store: syncOnly })
    expect(synced[0]!.status).toBe('swapped')
    expect(synced[0]!.swapId).toBeUndefined()
  }, 300_000)
})
