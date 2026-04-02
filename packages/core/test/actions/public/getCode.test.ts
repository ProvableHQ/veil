import { describe, it, expect, vi } from 'vitest'
import { getCode } from '../../../src/actions/public/getCode.js'

describe('getCode', () => {
  it('fetches program source by program ID', async () => {
    const source = 'program credits.aleo; ...'
    const client = {
      request: vi.fn().mockResolvedValue(source),
    } as any

    const result = await getCode(client, { program: 'credits.aleo' })
    expect(result).toBe(source)
    expect(client.request).toHaveBeenCalledWith({
      method: 'getProgram',
      params: { programId: 'credits.aleo' },
    })
  })
})
