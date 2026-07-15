import { describe, it, expect } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import { resolveDexImports } from '../../src/utils/imports.js'

// Scripted client: serves program sources by id via the getProgram action.
function fakeClient(sources: Record<string, string>): Client {
  return {
    request: async (req: { method: string; params?: { programId?: string } }) => {
      if (req.method !== 'getProgram') throw new Error(`unexpected ${req.method}`)
      const source = sources[req.params?.programId ?? '']
      if (!source) throw new Error(`unknown program ${req.params?.programId}`)
      return source
    },
  } as unknown as Client
}

describe('resolveDexImports', () => {
  it('collects token programs plus the DEX program\'s declared imports', async () => {
    const client = fakeClient({
      'token_a.aleo': 'program token_a.aleo;',
      'token_b.aleo': 'program token_b.aleo;',
      'shield_swap_v3.aleo': 'import test_shield_swap_multisig_core.aleo;\nprogram shield_swap_v3.aleo;',
      'test_shield_swap_multisig_core.aleo': 'program test_shield_swap_multisig_core.aleo;',
    })
    const imports = await resolveDexImports(client, { tokenPrograms: ['token_a.aleo', 'token_b.aleo'] })
    expect(Object.keys(imports).sort()).toEqual([
      'shield_swap_v3.aleo',
      'test_shield_swap_multisig_core.aleo',
      'token_a.aleo',
      'token_b.aleo',
    ].filter((p) => p !== 'shield_swap_v3.aleo'))
    expect(imports['test_shield_swap_multisig_core.aleo']).toContain('program test_shield_swap_multisig_core')
  })

  it('dedupes token programs and skips deps already provided', async () => {
    let fetches = 0
    const client = fakeClient(
      new Proxy(
        {
          'token_a.aleo': 'program token_a.aleo;',
          'shield_swap_v3.aleo': 'import token_a.aleo;\nprogram shield_swap_v3.aleo;',
        },
        {
          get(t, k) {
            fetches++
            return t[k as keyof typeof t]
          },
        },
      ) as Record<string, string>,
    )
    const imports = await resolveDexImports(client, { tokenPrograms: ['token_a.aleo', 'token_a.aleo'] })
    expect(Object.keys(imports)).toEqual(['token_a.aleo'])
    expect(fetches).toBe(2) // token_a once + the DEX source once
  })

  it('honors a program override', async () => {
    const client = fakeClient({
      'token_a.aleo': 'program token_a.aleo;',
      'shield_swap_alt.aleo': 'import dep_x.aleo;\nprogram shield_swap_alt.aleo;',
      'dep_x.aleo': 'program dep_x.aleo;',
    })
    const imports = await resolveDexImports(client, {
      tokenPrograms: ['token_a.aleo'],
      program: 'shield_swap_alt.aleo',
    })
    expect(Object.keys(imports).sort()).toEqual(['dep_x.aleo', 'token_a.aleo'])
  })
})
