import { describe, it, expect, vi } from 'vitest'
import { estimateGas } from '../../../src/actions/public/estimateGas.js'

describe('estimateGas', () => {
  it('delegates to transport estimateFee when available', async () => {
    const client = {
      request: vi.fn().mockResolvedValue('15000u64'),
    } as any

    const result = await estimateGas(client, {
      program: 'token.aleo',
      function: 'transfer',
      inputs: ['aleo1recipient', '100u64'],
    })

    expect(result).toBe(15000n)
    expect(client.request).toHaveBeenCalledWith({
      method: 'estimateFee',
      params: {
        programId: 'token.aleo',
        functionName: 'transfer',
        inputs: ['aleo1recipient', '100u64'],
      },
    })
  })

  it('handles numeric response from transport', async () => {
    const client = {
      request: vi.fn().mockResolvedValue(20000),
    } as any

    const result = await estimateGas(client, {
      program: 'token.aleo',
      function: 'transfer',
      inputs: ['aleo1recipient', '100u64'],
    })

    expect(result).toBe(20000n)
  })

  it('falls back to heuristic when transport throws', async () => {
    const client = {
      request: vi.fn().mockRejectedValue(new Error('Unknown method: estimateFee')),
    } as any

    const result = await estimateGas(client, {
      program: 'token.aleo',
      function: 'transfer',
      inputs: ['aleo1recipient', '100u64'],
    })

    // BASE_FEE (10_000) + 2 inputs * PER_INPUT_FEE (1_000) = 12_000
    expect(result).toBe(12000n)
  })

  it('heuristic scales with number of inputs', async () => {
    const client = {
      request: vi.fn().mockRejectedValue(new Error('not supported')),
    } as any

    const noInputs = await estimateGas(client, {
      program: 'test.aleo',
      function: 'init',
      inputs: [],
    })

    const threeInputs = await estimateGas(client, {
      program: 'test.aleo',
      function: 'complex',
      inputs: ['input1', 'input2', 'input3'],
    })

    expect(noInputs).toBe(10000n) // BASE_FEE only
    expect(threeInputs).toBe(13000n) // BASE_FEE + 3 * 1000
    expect(threeInputs).toBeGreaterThan(noInputs)
  })

  it('falls back to heuristic when transport returns null', async () => {
    const client = {
      request: vi.fn().mockResolvedValue(null),
    } as any

    const result = await estimateGas(client, {
      program: 'test.aleo',
      function: 'run',
      inputs: ['arg1'],
    })

    expect(result).toBe(11000n) // 10_000 + 1 * 1_000
  })
})
