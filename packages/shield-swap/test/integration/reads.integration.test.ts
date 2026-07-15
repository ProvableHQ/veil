import { describe, it, expect } from 'vitest'
import { createPublicClient, http } from '@provablehq/veil-core'
import { getPool } from '../../src/actions/reads/getPool.js'
import { getSlot } from '../../src/actions/reads/getSlot.js'
import { getSwapOutput } from '../../src/actions/reads/getSwapOutput.js'
import { isBlindedAddressUsed } from '../../src/actions/reads/isBlindedAddressUsed.js'
import { isPoolInitialized } from '../../src/actions/reads/isPoolInitialized.js'
import { isFeeTierValid } from '../../src/actions/reads/isFeeTierValid.js'
import { isTickSpacingValid } from '../../src/actions/reads/isTickSpacingValid.js'
import { getFeeToTickSpacing } from '../../src/actions/reads/getFeeToTickSpacing.js'
import { getPosition } from '../../src/actions/reads/getPosition.js'
import { getTick } from '../../src/actions/reads/getTick.js'
import { isGlobalPaused } from '../../src/actions/reads/isGlobalPaused.js'
import { isPoolCreationOpen } from '../../src/actions/reads/isPoolCreationOpen.js'
import { isTokenAllowed } from '../../src/actions/reads/isTokenAllowed.js'
import { isTokenPaused } from '../../src/actions/reads/isTokenPaused.js'
import { isPairPaused } from '../../src/actions/reads/isPairPaused.js'
import { getFrozenPosition } from '../../src/actions/reads/getFrozenPosition.js'
import { getTokenDecimals } from '../../src/actions/reads/getTokenDecimals.js'
import { getTradeControls } from '../../src/actions/reads/getTradeControls.js'
import { ApiClient, authenticateWithAccount } from '../../src/api/client.js'
import { PROGRAM_ID } from '../../src/generated/shield_swap.js'

// Real-API integration: hits the live testnet node and the live DEX API.
// Never mocked — these tests exist to catch drift between this client and the
// deployed contract/API. Gated so the default offline suite stays fast.
// The fee-tier registry endpoint is bearer-gated, so that one test
// additionally needs VEIL_E2E_PRIVATE_KEY to sign the API challenge.
const RUN = process.env.VEIL_INTEGRATION === '1'
const PRIVATE_KEY = process.env.VEIL_E2E_PRIVATE_KEY

const API_BASE = 'https://api.provable.com/v2'
const NODE_URL = `${API_BASE}/testnet`
const INDEXER_URL = 'https://amm-api.dev.provable.com'

// Reads default to PROGRAM_ID (shield_swap_v3), so a pool discovered via the
// API decodes directly off chain, no fallback needed.

describe.runIf(RUN)('reads against the real API', () => {
  const client = createPublicClient({ transport: http(API_BASE, { network: 'testnet' }) })

  it('getPool decodes a live pool discovered via the API', async () => {
    const res = await fetch(`${INDEXER_URL}/pools?limit=1`)
    expect(res.ok).toBe(true)
    const body = (await res.json()) as { data: { key: string }[] }
    expect(body.data.length).toBeGreaterThan(0)
    const poolKey = body.data[0]!.key

    const pool = await getPool(client, { poolKey })

    expect(pool).not.toBeNull()
    // Live values change; assert shape and width, not exact numbers.
    expect(typeof pool!.token0).toBe('string')
    expect(pool!.token0.endsWith('field')).toBe(true)
    expect(typeof pool!.token1).toBe('string')
    expect(typeof pool!.fee).toBe('number')
    expect(typeof pool!.enabled).toBe('boolean')
    expect(typeof pool!.scale0).toBe('bigint')
    expect(typeof pool!.scale1).toBe('bigint')
  }, 30_000)

  it('getPool returns null for a key that is not in the mapping', async () => {
    // A fixed 75-digit key — astronomically unlikely to collide with a real
    // BHP256-derived pool key, so this stays a missing-key probe forever.
    const absentKey = '111111111111111111111111111111111111111111111111111111111111111111111111111field'
    const pool = await getPool(client, { poolKey: absentKey })
    expect(pool).toBeNull()
  }, 30_000)

  it('getSlot decodes live trading state for an API-discovered pool', async () => {
    const res = await fetch(`${INDEXER_URL}/pools?limit=1`)
    const body = (await res.json()) as { data: { key: string }[] }
    const poolKey = body.data[0]!.key

    const slot = await getSlot(client, { poolKey })

    expect(slot).not.toBeNull()
    expect(typeof slot!.tick).toBe('number')
    expect(typeof slot!.tick_spacing).toBe('number')
    expect(typeof slot!.sqrt_price).toBe('bigint')
    expect(slot!.sqrt_price > 0n).toBe(true)
    expect(typeof slot!.liquidity).toBe('bigint')
    expect(typeof slot!.next_init_below).toBe('number')
    expect(typeof slot!.next_init_above).toBe('number')
  }, 30_000)

  it('getSwapOutput returns null for an unknown swap id', async () => {
    const absent = '222222222222222222222222222222222222222222222222222222222222222222222222222field'
    expect(await getSwapOutput(client, { swapId: absent })).toBeNull()
  }, 30_000)

  it.runIf(!!PRIVATE_KEY)('validation reads agree with the API fee-tier registry', async () => {
    const { loadNetwork } = await import('@provablehq/veil-aleo-sdk')
    const api = new ApiClient({ baseUrl: INDEXER_URL })
    const aleo = await loadNetwork('testnet')
    await authenticateWithAccount(api, aleo.privateKeyToAccount(PRIVATE_KEY!))
    const tiers = await api.getFeeTiers()
    expect(tiers.data.length).toBeGreaterThan(0)
    const fee = tiers.data[0]!.fee_tier

    // The target deployment must register the fee the API advertises,
    // bind a tick spacing to it, and register that spacing.
    expect(await isFeeTierValid(client, { fee })).toBe(true)
    const spacing = await getFeeToTickSpacing(client, { fee })
    expect(spacing).not.toBeNull()
    expect(await isTickSpacingValid(client, { tickSpacing: spacing! })).toBe(true)
    // An unregistered fee reads false, not an error.
    expect(await isFeeTierValid(client, { fee: 65535 })).toBe(false)
  }, 30_000)

  it('isPoolInitialized and isBlindedAddressUsed treat absence as false', async () => {
    const absentKey = '333333333333333333333333333333333333333333333333333333333333333333333333333field'
    expect(await isPoolInitialized(client, { poolKey: absentKey })).toBe(false)
    // A fresh, never-used address (the zero-value address literal).
    const fresh = 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc'
    expect(await isBlindedAddressUsed(client, { address: fresh })).toBe(false)
  }, 30_000)

  it('tick math brackets a live pool sqrt_price (table agrees with chain)', async () => {
    const { getSqrtPriceAtTick } = await import('../../src/utils/tick-math.js')
    const res = await fetch(`${INDEXER_URL}/pools?limit=1`)
    const body = (await res.json()) as { data: { key: string }[] }
    const poolKey = body.data[0]!.key
    const slot = await getSlot(client, { poolKey })
    expect(slot).not.toBeNull()
    // The live sqrt_price must sit inside its active tick's bracket — a
    // one-off magic constant in our port would break this immediately.
    expect(slot!.sqrt_price >= getSqrtPriceAtTick(slot!.tick)).toBe(true)
    expect(slot!.sqrt_price < getSqrtPriceAtTick(slot!.tick + 1)).toBe(true)
  }, 30_000)

  it('a freshly derived blinded identity is unused on chain', async () => {
    // Devnode test account (public key) — same fixtures as the golden vectors.
    const { nextBlindedIdentity } = await import('../../src/utils/blinding/identity.js')
    const id = await nextBlindedIdentity(client, {
      viewKeyScalar: '334926304971763782347498121479281870911723639068413954564748091722770623877scalar',
      signer: 'aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px',
    })
    // The scan itself asserted the address is unused; sanity-check the shape.
    expect(id.counter).toBeGreaterThanOrEqual(0)
    expect(id.blindingFactor.endsWith('field')).toBe(true)
    expect(id.blindedAddress.startsWith('aleo1')).toBe(true)
    expect(await isBlindedAddressUsed(client, { address: id.blindedAddress })).toBe(false)
  }, 60_000)

  it(`target program ${PROGRAM_ID} is deployed with the expected mappings`, async () => {
    const res = await fetch(`${NODE_URL}/program/${PROGRAM_ID}/mappings`)
    expect(res.ok).toBe(true)
    const mappings = (await res.json()) as string[]
    for (const m of [
      'pools', 'slots', 'swap_outputs', 'used_blinded_addresses',
      'positions', 'ticks', 'global_paused', 'token_allowed', 'token_paused',
      'pair_paused', 'frozen_position', 'token_decimals', 'pool_creation_is_open',
    ]) {
      expect(mappings).toContain(m)
    }
  }, 30_000)

  it('getTradeControls agrees with the individual control reads on a live pool', async () => {
    const res = await fetch(`${INDEXER_URL}/pools?limit=1`)
    const body = (await res.json()) as { data: { key: string }[] }
    const poolKey = body.data[0]!.key

    const controls = await getTradeControls(client, { poolKey })
    const pool = await getPool(client, { poolKey })

    expect(controls.poolEnabled).toBe(pool!.enabled)
    expect(controls.globalPaused).toBe(await isGlobalPaused(client))
    expect(controls.token0.allowed).toBe(await isTokenAllowed(client, { tokenId: pool!.token0 }))
    expect(controls.token0.paused).toBe(await isTokenPaused(client, { tokenId: pool!.token0 }))
    expect(controls.pairPaused).toBe(
      await isPairPaused(client, { token0: pool!.token0, token1: pool!.token1 }),
    )
    // The verdict is exactly the swap-finalize conjunction.
    expect(controls.tradeable).toBe(
      !controls.globalPaused &&
        controls.poolEnabled &&
        !controls.token0.paused &&
        !controls.token1.paused &&
        !controls.pairPaused,
    )
  }, 60_000)

  it('token decimals are registered for a live pool pair', async () => {
    const res = await fetch(`${INDEXER_URL}/pools?limit=1`)
    const body = (await res.json()) as { data: { key: string }[] }
    const pool = await getPool(client, { poolKey: body.data[0]!.key })

    // create_pool hard-requires registration, so a live pool's tokens read back.
    const decimals0 = await getTokenDecimals(client, { tokenId: pool!.token0 })
    expect(decimals0).not.toBeNull()
    expect(decimals0!).toBeGreaterThanOrEqual(0)
    // Absent controls read their get_or_use defaults, not errors.
    expect(typeof (await isPoolCreationOpen(client))).toBe('boolean')
    expect(await getFrozenPosition(client, { positionTokenId: '444444444444444444field' })).toBeNull()
  }, 60_000)

  it('getTick reads an initialized tick via the slot neighbors', async () => {
    const res = await fetch(`${INDEXER_URL}/pools?limit=1`)
    const body = (await res.json()) as { data: { key: string }[] }
    const poolKey = body.data[0]!.key
    const slot = await getSlot(client, { poolKey })

    // next_init_above/below point at initialized ticks (or the extremes);
    // probe one that is a real entry when in range.
    const target = slot!.next_init_above
    const tick = await getTick(client, { poolKey, tick: target })
    if (tick !== null) {
      expect(tick.tick).toBe(target)
      expect(typeof tick.liquidity_gross).toBe('bigint')
      expect(typeof tick.prev).toBe('number')
      expect(typeof tick.next).toBe('number')
    }
    // An out-of-domain tick is never initialized.
    expect(await getTick(client, { poolKey, tick: 399999 })).toBeNull()
  }, 60_000)

  it('getPosition returns null for an unknown position id', async () => {
    const absent = '555555555555555555555555555555555555555555555555555555555555555555555555555field'
    expect(await getPosition(client, { positionTokenId: absent })).toBeNull()
  }, 30_000)
})
