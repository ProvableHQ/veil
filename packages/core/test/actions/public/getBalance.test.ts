import { describe, it, expect, vi } from 'vitest'
import { getBalance } from '../../../src/actions/public/getBalance.js'

describe('getBalance', () => {
  it('returns balance as bigint from number', async () => {
    const client = {
      request: vi.fn().mockResolvedValue(5000000),
    } as any

    const result = await getBalance(client, { address: 'aleo1abc' })
    expect(result).toBe(5000000n)
  })

  it('strips u64 suffix from string response', async () => {
    const client = {
      request: vi.fn().mockResolvedValue('5000000u64'),
    } as any

    const result = await getBalance(client, { address: 'aleo1abc' })
    expect(result).toBe(5000000n)
  })

  it('handles large balances without precision loss', async () => {
    const client = {
      request: vi.fn().mockResolvedValue('18446744073709551615u64'),
    } as any

    const result = await getBalance(client, { address: 'aleo1abc' })
    expect(result).toBe(18446744073709551615n)
  })
})
