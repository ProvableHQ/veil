import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { calculatePositionFill } from './lp-fill-tracker.js'

const Q128 = 1n << 128n

describe('calculatePositionFill', () => {
  it('reports the inventory exchanged as price moves through a position range', () => {
    expect(
      calculatePositionFill({
        liquidity: 100n,
        sqrtLowerX128: Q128,
        sqrtUpperX128: 2n * Q128,
        sqrtPriceBeforeX128: Q128,
        sqrtPriceAfterX128: 2n * Q128,
      }),
    ).toEqual({ amount0: -50n, amount1: 100n })
  })

  it('reverses the inventory deltas when price traverses the range in the other direction', () => {
    expect(
      calculatePositionFill({
        liquidity: 100n,
        sqrtLowerX128: Q128,
        sqrtUpperX128: 2n * Q128,
        sqrtPriceBeforeX128: 2n * Q128,
        sqrtPriceAfterX128: Q128,
      }),
    ).toEqual({ amount0: 50n, amount1: -100n })
  })
})

describe('lp-fill-tracker script', () => {
  it('starts tracking when invoked directly', () => {
    const script = fileURLToPath(new URL('./lp-fill-tracker.ts', import.meta.url))
    const result = spawnSync('pnpm', ['exec', 'tsx', script], {
      encoding: 'utf8',
      env: { ...process.env, VEIL_POSITION_TOKEN_ID: '' },
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Set VEIL_POSITION_TOKEN_ID')
  })
})
