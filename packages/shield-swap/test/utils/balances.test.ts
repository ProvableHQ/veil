import { describe, it, expect } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import { getBalances } from '../../src/utils/balances.js'
import type { ApiClient } from '../../src/api/client.js'

const wrapperRecord = (amount: string) =>
  `{\n  owner: aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc.private,\n  amount: ${amount}.private,\n  _nonce: 1group.public\n}`

/** Wallet-client fake whose scanner returns the given plaintexts as unspent records. */
function recordsClient(byProgram: Record<string, string[]>, address = 'aleo1me'): Client {
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

const TOKENS = [
  { address: 'ethxField', symbol: 'ETHx', decimals: 18, wrapper_program: 'ethx.aleo', id: '1', name: 'ETHx' },
  { address: 'usdcField', symbol: 'USDCx', decimals: 6, wrapper_program: 'usdc.aleo', id: '2', name: 'USDC' },
  { address: 'zzzField', symbol: 'ZZZ', decimals: 6, wrapper_program: 'zzz.aleo', id: '3', name: 'ZZZ' },
]

describe('getBalances', () => {
  it('joins public (API) + private (records) into a per-token total, keyed by token id', async () => {
    const client = recordsClient({ 'ethx.aleo': [wrapperRecord('3u128'), wrapperRecord('2u128')], 'usdc.aleo': [] })
    const api = fakeApi(TOKENS, [
      { token_id: 'ethxField', token_address: 'ethxField', symbol: 'ETHx', decimals: 18, name: 'ETHx', balance: '5' },
      { token_id: 'usdcField', token_address: 'usdcField', symbol: 'USDCx', decimals: 6, name: 'USDC', balance: '100' },
    ])

    const bals = await getBalances(client, api, { user: 'aleo1me' })
    expect(bals['ethxField']).toEqual({ symbol: 'ETHx', decimals: 18, public: 5n, private: 5n, total: 10n })
    expect(bals['usdcField']).toEqual({ symbol: 'USDCx', decimals: 6, public: 100n, private: 0n, total: 100n })
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
