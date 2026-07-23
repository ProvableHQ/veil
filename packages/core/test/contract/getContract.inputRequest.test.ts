import { describe, it, expect, vi } from 'vitest'
import { getContract } from '../../src/contract/getContract.js'
import { parseProgram } from '../../src/contract/parseProgram.js'
import type { ABI } from '../../src/types/abi.js'
import type { InputRequest } from '../../src/types/inputRequest.js'

function mockWalletClient() {
  const writeContract = vi.fn().mockResolvedValue('at1tx')
  return { client: { writeContract } as any, writeContract }
}

// ── Rich ABI path (resolvedAbi → encodeInputs per-position) ────────────

describe('getContract resolveInputs — rich ABI mixed path', () => {
  // Minimal rich ABI: a record input, a field input, and a u128 input.
  const abi: ABI = {
    program: 'amm.aleo',
    structs: [],
    records: [],
    mappings: [],
    storageVariables: [],
    functions: [
      {
        name: 'swap',
        isFinal: false,
        inputs: [
          { name: 'position', type: { kind: 'record', path: ['Position'] }, mode: 'private' },
          { name: 'blinding', type: { kind: 'plaintext', type: { kind: 'primitive', primitive: 'field' } }, mode: 'private' },
          { name: 'amount', type: { kind: 'plaintext', type: { kind: 'primitive', primitive: 'u128' } }, mode: 'public' },
        ],
        outputs: [],
      },
    ],
  }

  it('passes InputRequests through and encodes literals with the ABI type at each position', async () => {
    const { client, writeContract } = mockWalletClient()
    const c = getContract({ program: 'amm.aleo', abi, client })

    const recordReq: InputRequest = { type: 'record', program: 'amm.aleo', recordname: 'Position', uid: 'u1' }
    const derivedReq: InputRequest = { type: 'derived', algorithm: 'program-scoped-blinding-factor', args: {} }

    // position 2 is a number — must be ABI-encoded to `100u128`.
    await c.write.swap!({ inputs: [recordReq, derivedReq, 100] })

    const sent = writeContract.mock.calls[0]![0].inputs
    expect(sent[0]).toEqual(recordReq) // record request — untouched
    expect(sent[1]).toEqual(derivedReq) // derived request — untouched
    expect(sent[2]).toBe('100u128') // literal encoded with the position's ABI type
  })

  it('still encodes a pure-literal call identically (fast path unaffected)', async () => {
    const { client, writeContract } = mockWalletClient()
    const c = getContract({ program: 'amm.aleo', abi, client })
    await c.write.swap!({ inputs: ['rec1', '5field', 42] })
    expect(writeContract.mock.calls[0]![0].inputs).toEqual(['rec1', '5field', '42u128'])
  })
})

// ── Parsed Program path (parseProgram) with a realistic swap signature ──
//
// Mirrors the shape of a real private-swap function (record + derived field +
// derived/injected address + literal tail) without committing a large deployed
// program blob. Exercises the parsed-Program encode branch of resolveInputs.

describe('getContract resolveInputs — parsed Program path, private-swap shape', () => {
  const source = `program amm_demo.aleo;

record Position:
    owner as address.private;
    liquidity as u128.private;

function swap_private:
    input r0 as Position.record;
    input r1 as field.private;
    input r2 as address.public;
    input r3 as u128.public;
    input r4 as boolean.public;
`
  const program = parseProgram(source)

  it('parses the program and exposes swap_private inputs', () => {
    const fn = program.functions.find((f) => f.name === 'swap_private')
    expect(fn).toBeDefined()
    expect(fn!.inputs).toHaveLength(5)
    expect(fn!.inputs[1]!.type).toBe('field') // blinding-factor slot
    expect(fn!.inputs[2]!.type).toBe('address') // blinded-address / injected-address slot
  })

  it('carries record/derived/address InputRequests through at the right positions', async () => {
    const { client, writeContract } = mockWalletClient()
    const c = getContract({ program: 'amm_demo.aleo', abi: program, client })

    const recordReq: InputRequest = { type: 'record', program: 'amm_demo.aleo', recordname: 'Position', uid: 'u1' }
    const blindingReq: InputRequest = { type: 'derived', algorithm: 'program-scoped-blinding-factor', args: { mode: { type: 'string', value: 'issue' } } }
    const blindedAddrReq: InputRequest = { type: 'derived', algorithm: 'program-scoped-blinded-address', args: { mode: { type: 'string', value: 'issue' } } }

    await c.write.swap_private!({
      inputs: [recordReq, blindingReq, blindedAddrReq, '100u128', 'true'],
    })

    const sent = writeContract.mock.calls[0]![0].inputs
    expect(sent).toHaveLength(5)
    expect(sent[0]).toEqual(recordReq)
    expect(sent[1]).toEqual(blindingReq)
    expect(sent[2]).toEqual(blindedAddrReq)
    expect(sent[3]).toBe('100u128') // literal tail untouched
    expect(sent[4]).toBe('true')
  })
})
