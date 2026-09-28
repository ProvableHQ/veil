import { describe, it, expect } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import { getPublicBalances } from '../../../src/actions/reads/getPublicBalances.js'

const HOLDER = 'aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px'

/** Scripted client answering `balances` mapping reads by program, recording each request. */
function fakeClient(
  byProgram: Record<string, string | null>,
  seen: { program: string; mapping: string; key: string }[] = [],
  address?: string,
): Client {
  return {
    ...(address ? { account: { type: 'rpc', address } } : {}),
    request: async (req: { method: string; params?: { programId?: string; mapping?: string; key?: string } }) => {
      if (req.method !== 'getMappingValue') throw new Error(`unexpected method ${req.method}`)
      const { programId: program = '', mapping = '', key = '' } = req.params ?? {}
      seen.push({ program, mapping, key })
      return byProgram[program] ?? null
    },
  } as unknown as Client
}

describe('getPublicBalances', () => {
  it('reads each program\'s balances mapping under the user address and decodes u128 literals', async () => {
    const seen: { program: string; mapping: string; key: string }[] = []
    const client = fakeClient(
      { 'test_arc20_eth.aleo': '5000000000000000000u128', 'shield_swap_arc20_credits.aleo': '100u128' },
      seen,
    )

    const balances = await getPublicBalances(client, {
      user: HOLDER,
      programs: ['test_arc20_eth.aleo', 'shield_swap_arc20_credits.aleo'],
    })

    expect(balances).toEqual({
      'test_arc20_eth.aleo': 5000000000000000000n,
      'shield_swap_arc20_credits.aleo': 100n,
    })
    expect(seen.map((r) => r.program).sort()).toEqual(['shield_swap_arc20_credits.aleo', 'test_arc20_eth.aleo'])
    expect(seen.every((r) => r.mapping === 'balances' && r.key === HOLDER)).toBe(true)
  })

  it('treats an absent mapping entry as a zero balance and deduplicates programs', async () => {
    const seen: { program: string; mapping: string; key: string }[] = []
    const client = fakeClient({}, seen)

    const balances = await getPublicBalances(client, { user: HOLDER, programs: ['zzz.aleo', 'zzz.aleo'] })

    expect(balances).toEqual({ 'zzz.aleo': 0n })
    expect(seen).toHaveLength(1)
  })

  it('defaults the user to the client account address', async () => {
    const seen: { program: string; mapping: string; key: string }[] = []
    const client = fakeClient({ 'test_arc20_eth.aleo': '7u128' }, seen, HOLDER)

    const balances = await getPublicBalances(client, { programs: ['test_arc20_eth.aleo'] })

    expect(balances).toEqual({ 'test_arc20_eth.aleo': 7n })
    expect(seen[0]!.key).toBe(HOLDER)
  })

  it('throws when no user is given and the client has no account', async () => {
    await expect(getPublicBalances(fakeClient({}), { programs: ['test_arc20_eth.aleo'] })).rejects.toThrow(
      /needs a user address/,
    )
  })

  it('rejects a stored value that is not an unsigned integer literal', async () => {
    const client = fakeClient({ 'odd.aleo': '{ amount: 1u128 }' })
    await expect(getPublicBalances(client, { user: HOLDER, programs: ['odd.aleo'] })).rejects.toThrow(
      /not an unsigned integer literal/,
    )
  })
})
