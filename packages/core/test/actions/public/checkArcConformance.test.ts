import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { checkArcConformance } from '../../../src/actions/public/checkArcConformance.js'
import { isArc20 } from '../../../src/actions/public/isArc20.js'
import { isArc22 } from '../../../src/actions/public/isArc22.js'

const arc20Vector = readFileSync(join(__dirname, '../../fixtures/programs/test_arc20_eth.aleo'), 'utf8')

describe('checkArcConformance action', () => {
  it('fetches by programId and reports conformance', async () => {
    const client = { request: vi.fn().mockResolvedValue(arc20Vector) } as any
    const report = await checkArcConformance(client, { programId: 'test_arc20_eth.aleo', standard: 'arc20' })
    expect(client.request).toHaveBeenCalledWith({
      method: 'getProgram',
      params: { programId: 'test_arc20_eth.aleo' },
    })
    expect(report.conforms).toBe(true)
    expect(report.programId).toBe('test_arc20_eth.aleo')
  })

  it('analyzes provided source without any network call', async () => {
    const client = { request: vi.fn() } as any
    const report = await checkArcConformance(client, { source: arc20Vector, standard: 'arc22' })
    expect(client.request).not.toHaveBeenCalled()
    expect(report.conforms).toBe(false)
  })

  it('rejects when both programId and source are given', async () => {
    const client = { request: vi.fn() } as any
    await expect(
      checkArcConformance(client, { programId: 'a.aleo', source: 'x', standard: 'arc20' } as any),
    ).rejects.toThrow('exactly one')
  })

  it('rejects when neither programId nor source is given', async () => {
    const client = { request: vi.fn() } as any
    await expect(checkArcConformance(client, { standard: 'arc20' } as any)).rejects.toThrow('exactly one')
  })
})

describe('isArc20 / isArc22 actions', () => {
  it('isArc20 returns the boolean verdict', async () => {
    const client = { request: vi.fn().mockResolvedValue(arc20Vector) } as any
    await expect(isArc20(client, { programId: 'test_arc20_eth.aleo' })).resolves.toBe(true)
  })

  it('isArc22 returns false for an ARC-20 token', async () => {
    const client = { request: vi.fn() } as any
    await expect(isArc22(client, { source: arc20Vector })).resolves.toBe(false)
  })
})
