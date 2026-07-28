import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseAbi } from '@provablehq/veil-core'

describe('pinned shield_swap ABI', () => {
  it('parses and contains the core entrypoints', () => {
    const abiPath = new URL('../codegen/abi/shield_swap.json', import.meta.url)
    const raw = JSON.parse(readFileSync(abiPath, 'utf-8'))
    const abi = parseAbi(raw)
    const fns = new Set(abi.functions.map((f) => f.name))
    for (const f of ['swap', 'claim_swap_output', 'create_pool', 'mint', 'increase_liquidity', 'decrease_liquidity', 'collect', 'burn', 'allow_token']) {
      expect(fns.has(f)).toBe(true)
    }
    const maps = new Set(abi.mappings.map((m) => m.name))
    for (const m of ['pools', 'slots', 'swap_outputs', 'used_blinded_addresses', 'from_wrapper_token_id', 'to_wrapper_token_id']) {
      expect(maps.has(m)).toBe(true)
    }
  })

  it('parses the swap and lp router pins', () => {
    for (const [file, transitions] of [
      ['shield_swap_router.json', ['swap_from_wrapped', 'claim_to_wrapped_refund_arc20']],
      ['shield_swap_lp_router.json', ['mint_from_wrapped_arc20', 'collect_to_wrapped_wrapped']],
    ] as const) {
      const raw = JSON.parse(readFileSync(new URL(`../codegen/abi/${file}`, import.meta.url), 'utf-8'))
      const fns = new Set(parseAbi(raw).functions.map((f) => f.name))
      for (const t of transitions) expect(fns.has(t), `${file}: ${t}`).toBe(true)
    }
  })
})
