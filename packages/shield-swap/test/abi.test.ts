import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseAbi } from '@veil/core'

describe('pinned shield_swap ABI', () => {
  it('parses and contains the V1 entrypoints', () => {
    const abiPath = new URL('../codegen/abi/shield_swap_v0_0_2.json', import.meta.url)
    const raw = JSON.parse(readFileSync(abiPath, 'utf-8'))
    const abi = parseAbi(raw)
    const fns = new Set(abi.functions.map((f) => f.name))
    for (const f of ['swap_private', 'claim_swap_output_private', 'create_pool', 'mint_private', 'increase_liquidity_private']) {
      expect(fns.has(f)).toBe(true)
    }
    const maps = new Set(abi.mappings.map((m) => m.name))
    for (const m of ['pools', 'slots', 'swap_outputs', 'used_blinded_addresses']) {
      expect(maps.has(m)).toBe(true)
    }
  })
})
