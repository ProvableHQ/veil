import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { calculatePositionFill } from './lp-fill-tracker.js'

const Q128 = 1n << 128n
const SQRT_TICK_100_X128 = 341987953891916247014855103371247308527n

const fillIdentity = {
  tradeId: 'trade-1',
  positionTokenId: '11field',
  poolKey: '22field',
  transactionId: 'at1transaction',
  transitionId: 'au1transition',
  blockHeight: 123,
  transactionIndex: 4,
  transitionIndex: 2,
  legIndex: 0,
}

describe('calculatePositionFill', () => {
  it('returns the complete inventory fill as price moves through a position range', () => {
    expect(
      calculatePositionFill({
        ...fillIdentity,
        positionLiquidity: 1_000_000n,
        tickLower: 0,
        tickUpper: 100,
        sqrtPriceBeforeX128: Q128,
        sqrtPriceAfterX128: SQRT_TICK_100_X128,
        tickBefore: 0,
        tickAfter: 100,
        zeroForOne: false,
      }),
    ).toEqual({
      ...fillIdentity,
      positionLiquidity: 1_000_000n,
      tickLower: 0,
      tickUpper: 100,
      sqrtPriceBeforeX128: Q128,
      sqrtPriceAfterX128: SQRT_TICK_100_X128,
      tickBefore: 0,
      tickAfter: 100,
      zeroForOne: false,
      amount0Before: 4987n,
      amount1Before: 0n,
      amount0After: 0n,
      amount1After: 5012n,
    })
  })

  it('reverses the inventory states when price traverses the range in the other direction', () => {
    expect(
      calculatePositionFill({
        ...fillIdentity,
        positionLiquidity: 1_000_000n,
        tickLower: 0,
        tickUpper: 100,
        sqrtPriceBeforeX128: SQRT_TICK_100_X128,
        sqrtPriceAfterX128: Q128,
        tickBefore: 100,
        tickAfter: 0,
        zeroForOne: true,
      }),
    ).toMatchObject({
      amount0Before: 0n,
      amount1Before: 5012n,
      amount0After: 4987n,
      amount1After: 0n,
    })
  })
})

describe('lp-fill-tracker script', () => {
  it('explains how to supply the required position token id', () => {
    const script = fileURLToPath(new URL('./lp-fill-tracker.ts', import.meta.url))
    const result = spawnSync('pnpm', ['exec', 'tsx', script], {
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'Usage: pnpm exec tsx examples/shield-swap/lp-fill-tracker.ts <position-token-id>',
    )
  })

  it('passes the positional position token id to the tracker', () => {
    const script = fileURLToPath(new URL('./lp-fill-tracker.ts', import.meta.url))
    const result = spawnSync('pnpm', ['exec', 'tsx', script, '11field'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ALEO_CONSUMER_ID: '',
        ALEO_DPS_API_KEY: '',
        VEIL_POSITION_TOKEN_ID: '',
      },
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('No Provable API credentials')
  })
})
