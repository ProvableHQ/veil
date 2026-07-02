import { describe, it, expect } from 'vitest'
import { createPublicClient, http } from '@veil/core'
import { getPool } from '../../src/actions/reads/getPool.js'
import { PROGRAM_ID } from '../../src/generated/shield_swap.js'

// Real-API integration: hits the live testnet node and the live AMM indexer.
// Never mocked — these tests exist to catch drift between this client and the
// deployed contract/API. Gated so the default offline suite stays fast.
const RUN = process.env.VEIL_INTEGRATION === '1'

const API_BASE = 'https://api.provable.com/v2'
const NODE_URL = `${API_BASE}/testnet`
const INDEXER_URL = 'https://amm-api.dev.provable.com'

// The live indexer currently serves pools created on shield_swap_v0_0_1; the
// v0_0_2 deployment starts with empty mappings. Reads try the target program
// first and fall back to the previous version so the decode path is always
// exercised against real chain data. Remove the fallback once v0_0_2 has pools.
const PREVIOUS_PROGRAM = 'shield_swap_v0_0_1.aleo'

describe.runIf(RUN)('reads against the real API', () => {
  const client = createPublicClient({ transport: http(API_BASE, { network: 'testnet' }) })

  it('getPool decodes a live pool discovered via the indexer', async () => {
    const res = await fetch(`${INDEXER_URL}/pools?limit=1`)
    expect(res.ok).toBe(true)
    const body = (await res.json()) as { data: { key: string }[] }
    expect(body.data.length).toBeGreaterThan(0)
    const poolKey = body.data[0]!.key

    let pool = await getPool(client, { poolKey })
    if (pool === null) {
      // v0_0_2 state not yet populated — decode the same layout from the
      // previous deployment to keep the real-data path covered.
      pool = await getPool(client, { poolKey, program: PREVIOUS_PROGRAM })
    }

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

  it(`target program ${PROGRAM_ID} is deployed with the expected mappings`, async () => {
    const res = await fetch(`${NODE_URL}/program/${PROGRAM_ID}/mappings`)
    expect(res.ok).toBe(true)
    const mappings = (await res.json()) as string[]
    for (const m of ['pools', 'slots', 'swap_outputs', 'used_blinded_addresses']) {
      expect(mappings).toContain(m)
    }
  }, 30_000)
})
