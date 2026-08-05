import { describe, it, expect } from 'vitest'
import {
  SHIELD_WRAPPERS,
  SHIELD_WRAPPERS_BY_NETWORK,
  shieldWrappersFor,
} from '../src/constants.js'

describe('shield wrapper table', () => {
  it('names each network’s real underlying, which differ by the test_ prefix', () => {
    // Verified against both deployments: the wrapper program ids are identical,
    // but mainnet's underlyings drop `test_`. Reading the wrong row selects
    // records from a program that does not exist on the active network.
    expect(shieldWrappersFor('testnet')['shield_swap_arc20_wrapped_usdcx.aleo']!.underlying).toBe(
      'test_usdcx_stablecoin.aleo',
    )
    expect(shieldWrappersFor('mainnet')['shield_swap_arc20_wrapped_usdcx.aleo']!.underlying).toBe(
      'usdcx_stablecoin.aleo',
    )
    expect(shieldWrappersFor('testnet')['shield_swap_arc20_wrapped_usad.aleo']!.underlying).toBe(
      'test_usad_stablecoin.aleo',
    )
    expect(shieldWrappersFor('mainnet')['shield_swap_arc20_wrapped_usad.aleo']!.underlying).toBe(
      'usad_stablecoin.aleo',
    )
  })

  it('wraps native credits identically on both networks', () => {
    for (const network of ['testnet', 'mainnet']) {
      expect(shieldWrappersFor(network)['shield_swap_arc20_credits.aleo']).toEqual({
        underlying: 'credits.aleo',
        symbol: 'ALEO',
      })
    }
  })

  it('treats an unknown network as testnet rather than throwing', () => {
    // Devnodes and forks report their own names; the testnet table is the right
    // guess there, and a throw would break local development.
    expect(shieldWrappersFor('devnet')).toEqual(SHIELD_WRAPPERS_BY_NETWORK.testnet)
  })

  it('keeps the deprecated export pointing at testnet', () => {
    expect(SHIELD_WRAPPERS).toBe(SHIELD_WRAPPERS_BY_NETWORK.testnet)
  })

  it('lists the same wrappers on both networks', () => {
    // A wrapper present on one network and missing on the other would make
    // routing network-dependent in a way callers cannot see.
    expect(Object.keys(SHIELD_WRAPPERS_BY_NETWORK.mainnet)).toEqual(
      Object.keys(SHIELD_WRAPPERS_BY_NETWORK.testnet),
    )
  })
})
