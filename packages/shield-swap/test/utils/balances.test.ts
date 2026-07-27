import { describe, it, expect } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import { getBalances } from '../../src/utils/balances.js'
import type { ApiClient } from '../../src/api/client.js'

const HOLDER = 'aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px'

const arc20Record = (amount: string) =>
  `{\n  owner: ${HOLDER}.private,\n  amount: ${amount}.private,\n  _nonce: 1group.public\n}`
// credits.aleo names its balance field microcredits, not amount.
const creditsRecord = (microcredits: string) =>
  `{\n  owner: ${HOLDER}.private,\n  microcredits: ${microcredits}.private,\n  _nonce: 1group.public\n}`

/** Wallet-client fake whose scanner returns the given plaintexts as unspent records. */
function recordsClient(byProgram: Record<string, string[]>, address = HOLDER): Client {
  return {
    account: { type: 'rpc', address },
    request: async (req: { method: string; params: { program: string } }) => {
      if (req.method !== 'requestRecords') throw new Error(`unexpected ${req.method}`)
      return (byProgram[req.params.program] ?? []).map((recordPlaintext, i) => ({
        programName: req.params.program,
        tag: `t${i}`,
        recordPlaintext,
        spent: false,
      }))
    },
  } as unknown as Client
}

/** Minimal ApiClient fake: only the two methods getBalances touches. */
function fakeApi(tokens: unknown[], publicBalances: unknown[]): ApiClient {
  return {
    getTokens: async () => ({ data: tokens }),
    getPublicBalances: async (_q: { user: string }) => ({ data: publicBalances }),
  } as unknown as ApiClient
}

// Token rows in the new shape: private records live in `underlying_program`
// (a plain ARC-20's own program, or a wrapped asset's underlying — credits
// for ALEO).
const TOKENS = [
  { address: 'ethField', symbol: 'ETH', decimals: 18, underlying_program: 'test_arc20_eth.aleo', amm_token_program: 'test_arc20_eth.aleo', id: '1', name: 'ETH' },
  { address: 'aleoField', symbol: 'ALEO', decimals: 6, underlying_program: 'credits.aleo', amm_token_program: 'shield_swap_arc20_credits.aleo', id: '2', name: 'Aleo' },
  { address: 'zzzField', symbol: 'ZZZ', decimals: 6, underlying_program: 'zzz.aleo', amm_token_program: 'zzz.aleo', id: '3', name: 'ZZZ' },
]

describe('getBalances', () => {
  it('joins public (API) + private (records) per token; sums ARC-20 amounts and credits microcredits', async () => {
    const client = recordsClient({
      'test_arc20_eth.aleo': [arc20Record('3u128'), arc20Record('2u128')],
      'credits.aleo': [creditsRecord('7u64')], // wrapped ALEO's underlying uses microcredits
    })
    const api = fakeApi(TOKENS, [
      { token_id: 'ethField', token_address: 'ethField', symbol: 'ETH', decimals: 18, name: 'ETH', balance: '5' },
      { token_id: 'aleoField', token_address: 'aleoField', symbol: 'ALEO', decimals: 6, name: 'Aleo', balance: '100' },
    ])

    const bals = await getBalances(client, api, { user: HOLDER })
    expect(bals['ethField']).toEqual({ symbol: 'ETH', decimals: 18, public: 5n, private: 5n, total: 10n })
    // ALEO's private balance comes from credits records (microcredits field).
    expect(bals['aleoField']).toEqual({ symbol: 'ALEO', decimals: 6, public: 100n, private: 7n, total: 107n })
    // ZZZ is held in neither → omitted when no explicit token filter is given.
    expect(bals['zzzField']).toBeUndefined()
  })

  it('reports explicitly-requested tokens even at zero, and defaults the user to the account address', async () => {
    const client = recordsClient({ 'zzz.aleo': [] })
    const bals = await getBalances(client, fakeApi(TOKENS, []), { tokens: ['zzzField'] })
    expect(bals).toEqual({ zzzField: { symbol: 'ZZZ', decimals: 6, public: 0n, private: 0n, total: 0n } })
  })

  it('throws when no user is given and the client has no account', async () => {
    const client = { request: async () => [] } as unknown as Client
    await expect(getBalances(client, fakeApi(TOKENS, []), {})).rejects.toThrow(/needs a user address/)
  })
})
