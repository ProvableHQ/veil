import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { getContract } from '../../src/contract/getContract.js'
import { parseProgram } from '../../src/contract/parseProgram.js'
import { parseAbi } from '../../src/utils/parseAbi.js'
import type { Plaintext } from '../../src/types/primitives.js'
import type { ProgramRegister } from '../../src/types/program.js'

// Both artifacts come from the same `leo build` of the ARC-22 reference
// template, so any disagreement between them is a parser bug, not a source
// difference. parseProgram (program text) and parseAbi (abi.json) feed the
// same getContract encoding logic and must derive identical type information.
const fixtures = join(__dirname, '../fixtures/programs')
const source = readFileSync(join(fixtures, 'compliant_token_template.aleo'), 'utf8')
const abiJson = JSON.parse(readFileSync(join(fixtures, 'compliant_token_template.abi.json'), 'utf8'))

const program = parseProgram(source)
const abi = parseAbi(abiJson)

// Flattens an ABI plaintext descriptor to the program-text spelling
// ("u128", "[field; 16u32]", "MerkleProof") for cross-artifact comparison.
function plaintextToText(pt: Plaintext): string {
  switch (pt.kind) {
    case 'primitive':
      return pt.primitive
    case 'array':
      return `[${plaintextToText(pt.element)}; ${pt.length}u32]`
    case 'struct':
      return (pt.program ? `${pt.program}/` : '') + pt.path.join('.')
    case 'optional':
      return plaintextToText(pt.inner)
  }
}

// Reduces a parsed register to a comparable descriptor.
function registerDescriptor(register: ProgramRegister): { kind: string; type?: string } {
  if (register.kind === 'plaintext') return { kind: 'plaintext', type: register.type }
  if (register.kind === 'record' || register.kind === 'future') return { kind: register.kind, type: register.type }
  return { kind: register.kind }
}

describe('parseProgram / parseAbi parity on the same leo build', () => {
  it('derives the same function set', () => {
    const abiNames = abi.functions.map((f) => f.name).sort()
    const programNames = program.functions.map((f) => f.name).sort()
    expect(programNames).toEqual(abiNames)
  })

  it('derives the same mapping set', () => {
    const abiNames = abi.mappings.map((m) => m.name).sort()
    const programNames = program.mappings.map((m) => m.name).sort()
    // parseAbi splits leo's auto-generated storage mappings out of `mappings`
    // into storageVariables; the program text still declares them as mappings.
    const storageNames = abi.storageVariables.map((s) => `${s.name}__`)
    expect(programNames).toEqual([...abiNames, ...storageNames].sort())
  })

  it('derives the same input signature at every register position of every function', () => {
    for (const abiFn of abi.functions) {
      const programFn = program.functions.find((f) => f.name === abiFn.name)!
      expect(programFn, `function ${abiFn.name} missing from parsed program`).toBeDefined()
      expect(programFn.inputs, `${abiFn.name} arity`).toHaveLength(abiFn.inputs.length)

      abiFn.inputs.forEach((abiInput, i) => {
        const register = registerDescriptor(programFn.inputs[i]!)
        const position = `${abiFn.name} input ${i}`

        if (abiInput.type.kind === 'plaintext') {
          expect(register.kind, position).toBe('plaintext')
          expect(register.type, position).toBe(plaintextToText(abiInput.type.type))
          // The plaintext visibility drives nothing in encoding but must agree too.
          expect((programFn.inputs[i] as { visibility: string }).visibility, position).toBe(abiInput.mode)
        } else if (abiInput.type.kind === 'record') {
          expect(register.kind, position).toBe('record')
          // The ABI qualifies even the program's own records with its id;
          // program text spells local records bare.
          const qualifier =
            abiInput.type.program && abiInput.type.program !== abi.program ? `${abiInput.type.program}/` : ''
          expect(register.type, position).toBe(qualifier + abiInput.type.path.join('.'))
        } else {
          expect(register.kind, position).toBe('dynamicRecord')
        }
      })
    }
  })

  it('derives the same output kinds at every position of every function', () => {
    for (const abiFn of abi.functions) {
      const programFn = program.functions.find((f) => f.name === abiFn.name)!
      expect(programFn.outputs, `${abiFn.name} output arity`).toHaveLength(abiFn.outputs.length)

      abiFn.outputs.forEach((abiOutput, i) => {
        const register = registerDescriptor(programFn.outputs[i]!)
        const position = `${abiFn.name} output ${i}`
        if (abiOutput.type.kind === 'plaintext') {
          expect(register.kind, position).toBe('plaintext')
          expect(register.type, position).toBe(plaintextToText(abiOutput.type.type))
        } else if (abiOutput.type.kind === 'record') {
          expect(register.kind, position).toBe('record')
        } else {
          expect(register.kind, position).toBe(abiOutput.type.kind)
        }
      })
    }
  })

  it('derives every ABI struct with identical fields', () => {
    // The ABI is pruned to interface-reachable types, so it is a subset of the
    // program text's structs; every ABI struct must parse identically.
    expect(abi.structs.length).toBeGreaterThan(0)
    for (const abiStruct of abi.structs) {
      const name = abiStruct.path.join('.')
      const programStruct = program.structs.find((s) => s.name === name)!
      expect(programStruct, `struct ${name} missing from parsed program`).toBeDefined()
      expect(programStruct.fields, name).toEqual(
        abiStruct.fields.map((f) => ({ name: f.name, type: plaintextToText(f.type) })),
      )
    }
  })

  it('derives every ABI record with identical fields and entry visibility', () => {
    expect(abi.records.length).toBeGreaterThan(0)
    for (const abiRecord of abi.records) {
      const name = abiRecord.path.join('.')
      const programRecord = program.records.find((r) => r.name === name)!
      expect(programRecord, `record ${name} missing from parsed program`).toBeDefined()
      expect(programRecord.fields, name).toEqual(
        abiRecord.fields.map((f) => ({ name: f.name, type: plaintextToText(f.type), visibility: f.mode })),
      )
    }
  })

  it('hasFinalize agrees with isFinal for every function', () => {
    for (const abiFn of abi.functions) {
      const programFn = program.functions.find((f) => f.name === abiFn.name)!
      expect(programFn.hasFinalize, abiFn.name).toBe(abiFn.isFinal)
    }
  })

  it('getContract encodes numeric inputs identically through both artifacts', async () => {
    const makeWallet = () => ({
      writeContract: vi.fn(), simulateContract: vi.fn().mockResolvedValue({ outputs: [] }), executeTransaction: vi.fn(),
      key: 'wallet', name: 'test',
      request: vi.fn(), transport: { config: {} as any, request: vi.fn() },
      uid: 'test', extend: vi.fn(),
      account: { type: 'local' as const, source: 'privateKey', address: 'aleo1abc', privateKey: 'pk', viewKey: 'vk', sign: vi.fn(), signMessage: vi.fn() },
      proving: { mode: 'local' as const },
      records: undefined,
    })

    // approve_public(spender: address.public, amount: u128.public) — the
    // number must encode as u128 through BOTH type sources.
    const inputs = ['aleo1spender', 5]
    const viaAbi = makeWallet()
    await getContract({ program: 'compliant_token_template.aleo', abi, client: viaAbi as any })
      .simulate.approve_public({ inputs })
    const viaProgram = makeWallet()
    await getContract({ program: 'compliant_token_template.aleo', abi: program, client: viaProgram as any })
      .simulate.approve_public({ inputs })

    expect(viaAbi.simulateContract.mock.calls[0][0].inputs).toEqual(['aleo1spender', '5u128'])
    expect(viaProgram.simulateContract.mock.calls[0][0].inputs).toEqual(
      viaAbi.simulateContract.mock.calls[0][0].inputs,
    )
  })
})
