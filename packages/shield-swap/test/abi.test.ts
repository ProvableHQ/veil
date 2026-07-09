import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseAbi } from '@veil/core'

describe('pinned shield_swap ABI', () => {
  it('parses and contains the v3 entrypoints', () => {
    const abiPath = new URL('../codegen/abi/shield_swap_v3.json', import.meta.url)
    const raw = JSON.parse(readFileSync(abiPath, 'utf-8'))
    const abi = parseAbi(raw)
    const fns = new Set(abi.functions.map((f) => f.name))
    for (const f of ['swap', 'claim_swap_output', 'create_pool', 'mint', 'increase_liquidity', 'decrease_liquidity', 'collect', 'burn']) {
      expect(fns.has(f)).toBe(true)
    }
    const maps = new Set(abi.mappings.map((m) => m.name))
    for (const m of ['pools', 'slots', 'swap_outputs', 'used_blinded_addresses']) {
      expect(maps.has(m)).toBe(true)
    }
  })
})
