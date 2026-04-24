import { describe, it, expect, vi } from 'vitest'
import { getTokenDetails } from '../../../src/actions/public/getTokenDetails.js'

describe('getTokenDetails', () => {
  it('returns token details with price history', async () => {
    const payload = {
      token: {
        token_id: '1u128',
        token_id_datatype: 'u128',
        symbol: 'FOO',
        display: 'Foo Token',
        program_name: 'foo.aleo',
        decimals: 6,
        total_supply: '1000000000000',
        verified: true,
        token_icon_url: null,
        compliance_freeze_list: null,
        price: '1.230000000',
        price_change_percentage_24h: '0.5',
        fully_diluted_value: null,
        total_market_cap: '1230000',
        volume_24h: '45000',
      },
      price_history: {
        pagination: {
          limit: 50,
          offset: 0,
          total_count: 200,
          has_next: true,
          has_previous: false,
        },
        data: [
          { day: '2026-04-22', price_usd: '1.230000000', volume_24h: '45000', total_market_cap: '1230000' },
        ],
      },
    }
    const client = { request: vi.fn().mockResolvedValue(payload) } as any
    const result = await getTokenDetails(client, { programId: 'foo.aleo' })
    expect(result).toEqual(payload)
    expect(client.request).toHaveBeenCalledWith({
      method: 'getTokenDetails',
      params: {
        programId: 'foo.aleo',
        tokenId: undefined,
        limit: undefined,
        offset: undefined,
        granularity: undefined,
      },
    })
  })

  it('passes optional params through when supplied', async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        token: {} as any,
        price_history: { pagination: {} as any, data: [] },
      }),
    } as any
    await getTokenDetails(client, {
      programId: 'foo.aleo',
      tokenId: '1u128',
      limit: 25,
      offset: 10,
      granularity: 'hourly',
    })
    expect(client.request).toHaveBeenCalledWith({
      method: 'getTokenDetails',
      params: {
        programId: 'foo.aleo',
        tokenId: '1u128',
        limit: 25,
        offset: 10,
        granularity: 'hourly',
      },
    })
  })
})
