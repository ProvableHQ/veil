import { describe, it, expect } from 'vitest'
import { tokenData, listTokens } from '../../src/utils/tokens.js'
import type { ApiClient } from '../../src/api/client.js'

const ROWS = [
  {
    address: '11field',
    symbol: 'USDCx',
    decimals: 6,
    amm_token_program: 'shield_swap_arc20_wrapped_usdcx.aleo',
    underlying_program: 'test_usdcx_stablecoin.aleo',
  },
  { address: '22field', symbol: 'ALEO', decimals: 6, amm_token_program: 'shield_swap_arc20_credits.aleo' },
  { address: '33field', symbol: 'ETHx', decimals: 18, amm_token_program: null, underlying_program: null },
]

/** API fake counting registry reads, since caching is part of the contract. */
function fakeApi(rows: unknown[] = ROWS, fail = false): { api: ApiClient; reads: () => number } {
  let reads = 0
  return {
    api: {
      getTokens: async () => {
        reads++
        if (fail) throw new Error('503')
        return { data: rows }
      },
    } as unknown as ApiClient,
    reads: () => reads,
  }
}

describe('listTokens', () => {
  it('maps registry rows and omits absent programs', async () => {
    const { api } = fakeApi()
    const tokens = await listTokens(api)
    expect(tokens[0]).toEqual({
      id: '11field',
      symbol: 'USDCx',
      decimals: 6,
      ammTokenProgram: 'shield_swap_arc20_wrapped_usdcx.aleo',
      underlyingProgram: 'test_usdcx_stablecoin.aleo',
    })
    // A null in the registry becomes an absent key, not a null value, so
    // `'ammTokenProgram' in token` means what it looks like.
    expect('ammTokenProgram' in tokens[2]!).toBe(false)
    expect('underlyingProgram' in tokens[1]!).toBe(false)
  })

  it('reads the registry once per client', async () => {
    const { api, reads } = fakeApi()
    await Promise.all([listTokens(api), listTokens(api), tokenData(api, 'ALEO')])
    // Twelve scripts asking the same question should cost one request, and the
    // concurrent case must share the in-flight promise rather than racing.
    expect(reads()).toBe(1)
  })

  it('does not cache a failure', async () => {
    const { api, reads } = fakeApi(ROWS, true)
    await expect(listTokens(api)).rejects.toThrow('503')
    await expect(listTokens(api)).rejects.toThrow('503')
    // A transient error must not poison the process by replaying forever.
    expect(reads()).toBe(2)
  })
})

describe('tokenData', () => {
  it('accepts an id, a symbol, and a symbol in any case', async () => {
    const { api } = fakeApi()
    expect((await tokenData(api, '22field')).symbol).toBe('ALEO')
    expect((await tokenData(api, 'USDCx')).id).toBe('11field')
    expect((await tokenData(api, 'usdcx')).id).toBe('11field')
    expect((await tokenData(api, '  ETHx  ')).id).toBe('33field')
  })

  it('names the available symbols when nothing matches', async () => {
    const { api } = fakeApi()
    // A typo is the likeliest cause, so the useful reply is the valid set —
    // and symbols are per network, so "not here" is often "wrong network".
    await expect(tokenData(api, 'USDC')).rejects.toThrow(/No token "USDC".*USDCx, ALEO, ETHx/s)
  })

  it('refuses an ambiguous symbol rather than guessing', async () => {
    const { api } = fakeApi([...ROWS, { address: '44field', symbol: 'ETHx', decimals: 18 }])
    await expect(tokenData(api, 'ETHx')).rejects.toThrow(/matches 2 tokens.*33field, 44field/s)
  })

  it('prefers an exact id over a symbol collision', async () => {
    // A token whose symbol is another token's id would otherwise be
    // unaddressable; ids are canonical, so they win.
    const { api } = fakeApi([...ROWS, { address: '55field', symbol: '11field', decimals: 0 }])
    expect((await tokenData(api, '11field')).symbol).toBe('USDCx')
  })
})
