import { describe, it, expect, vi } from 'vitest'
import { getCode, getProgram } from '../../../src/actions/public/getCode.js'

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

  it('getProgram is an alias for getCode', async () => {
    expect(getProgram).toBe(getCode)

    const source = 'program token.aleo; ...'
    const client = { request: vi.fn().mockResolvedValue(source) } as any

    const result = await getProgram(client, { program: 'token.aleo' })
    expect(result).toBe(source)
    expect(client.request).toHaveBeenCalledWith({
      method: 'getProgram',
      params: { programId: 'token.aleo' },
    })
  })
})
