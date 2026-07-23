import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { getContract } from '../../src/contract/getContract.js'
import { parseProgram } from '../../src/contract/parseProgram.js'
import { parseAbi } from '../../src/utils/parseAbi.js'
import type { ABI } from '../../src/types/abi.js'
import type { Plaintext } from '../../src/types/primitives.js'
import type { Program, ProgramRegister } from '../../src/types/program.js'

// Each fixture pair comes from one leo invocation over the same bytecode, so
// any disagreement between the two artifacts is a parser bug, not a source
// difference. parseProgram (program text) and parseAbi (abi.json) feed the
// same getContract encoding logic and must derive identical type information.
//
// - compliant_token_template: leo-built ARC-22 reference (records, futures,
//   external structs, every transfer shape).
// - parity_kitchen_sink: synthetic bytecode disassembled with `leo abi`,
//   covering bare struct inputs AND outputs, arrays of local structs, and a
//   struct-returning view — positions the template does not exercise.
const fixtures = join(__dirname, '../fixtures/programs')

function loadPair(name: string): { abi: ABI; abiViews: ABI['functions']; program: Program } {
  const source = readFileSync(join(fixtures, `${name}.aleo`), 'utf8')
  const abiJson = JSON.parse(readFileSync(join(fixtures, `${name}.abi.json`), 'utf8'))
  // parseAbi does not surface views; normalize them through the same machinery
  // by re-parsing the raw JSON with views presented as functions.
  const abiViews = parseAbi({ ...abiJson, functions: abiJson.views ?? [] }).functions
  return { abi: parseAbi(abiJson), abiViews, program: parseProgram(source) }
}

// Flattens an ABI plaintext descriptor to the program-text spelling
// ("u128", "[field; 16u32]", "MerkleProof") for cross-artifact comparison.
// The ABI qualifies even the owning program's types with its id; program
// text spells local types bare, so self-qualification is stripped.
function plaintextToText(pt: Plaintext, owner: string): string {
  switch (pt.kind) {
    case 'primitive':
      return pt.primitive
    case 'array':
      return `[${plaintextToText(pt.element, owner)}; ${pt.length}u32]`
    case 'struct':
      return (pt.program && pt.program !== owner ? `${pt.program}/` : '') + pt.path.join('.')
    case 'optional':
      return plaintextToText(pt.inner, owner)
  }
}

// Reduces a parsed register to a comparable descriptor.
function registerDescriptor(register: ProgramRegister): { kind: string; type?: string } {
  if (register.kind === 'plaintext') return { kind: 'plaintext', type: register.type }
  if (register.kind === 'record' || register.kind === 'future') return { kind: register.kind, type: register.type }
  return { kind: register.kind }
}

describe.each([
  // recordModesTrustworthy: leo's bytecode disassembler (`leo abi <file.aleo>`)
  // emits wrong record-field modes — the owner's visibility is inverted and
  // every other entry copies the owner's mode instead of its own (leo
  // crates/ast/src/composite/mod.rs, `from_external_record`; present through
  // leo 4.3.4). ABIs from `leo build` (Leo-source path) are unaffected. Until
  // fixed upstream, record-field modes are only compared on leo-build fixtures.
  { fixture: 'compliant_token_template', recordModesTrustworthy: true },
  { fixture: 'parity_kitchen_sink', recordModesTrustworthy: false },
])('parseProgram / parseAbi parity: $fixture', ({ fixture, recordModesTrustworthy }) => {
  const { abi, abiViews, program } = loadPair(fixture)

  // Views parse like functions; compare both callable sets with one walk.
  const callablePairs = [
    { label: 'function', abiFns: abi.functions, programFns: program.functions },
    { label: 'view', abiFns: abiViews, programFns: program.views },
  ]

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

  it('derives the same signature at every register position of every function and view', () => {
    for (const { label, abiFns, programFns } of callablePairs) {
      for (const abiFn of abiFns) {
        const programFn = programFns.find((f) => f.name === abiFn.name)!
        expect(programFn, `${label} ${abiFn.name} missing from parsed program`).toBeDefined()
        expect(programFn.inputs, `${label} ${abiFn.name} arity`).toHaveLength(abiFn.inputs.length)

        abiFn.inputs.forEach((abiInput, i) => {
          const register = registerDescriptor(programFn.inputs[i]!)
          const position = `${label} ${abiFn.name} input ${i}`

          if (abiInput.type.kind === 'plaintext') {
            expect(register.kind, position).toBe('plaintext')
            expect(register.type, position).toBe(plaintextToText(abiInput.type.type, abi.program))
            // The plaintext visibility drives nothing in encoding but must agree too.
            expect((programFn.inputs[i] as { visibility: string }).visibility, position).toBe(abiInput.mode)
          } else if (abiInput.type.kind === 'record') {
            expect(register.kind, position).toBe('record')
            const qualifier =
              abiInput.type.program && abiInput.type.program !== abi.program ? `${abiInput.type.program}/` : ''
            expect(register.type, position).toBe(qualifier + abiInput.type.path.join('.'))
          } else {
            expect(register.kind, position).toBe('dynamicRecord')
          }
        })

        expect(programFn.outputs, `${label} ${abiFn.name} output arity`).toHaveLength(abiFn.outputs.length)
        abiFn.outputs.forEach((abiOutput, i) => {
          const register = registerDescriptor(programFn.outputs[i]!)
          const position = `${label} ${abiFn.name} output ${i}`
          if (abiOutput.type.kind === 'plaintext') {
            expect(register.kind, position).toBe('plaintext')
            expect(register.type, position).toBe(plaintextToText(abiOutput.type.type, abi.program))
          } else if (abiOutput.type.kind === 'record') {
            expect(register.kind, position).toBe('record')
            const qualifier =
              abiOutput.type.program && abiOutput.type.program !== abi.program ? `${abiOutput.type.program}/` : ''
            expect(register.type, position).toBe(qualifier + abiOutput.type.path.join('.'))
          } else {
            expect(register.kind, position).toBe(abiOutput.type.kind)
          }
        })
      }
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
        abiStruct.fields.map((f) => ({ name: f.name, type: plaintextToText(f.type, abi.program) })),
      )
    }
  })

  it('derives every ABI record with identical fields', () => {
    expect(abi.records.length).toBeGreaterThan(0)
    for (const abiRecord of abi.records) {
      const name = abiRecord.path.join('.')
      const programRecord = program.records.find((r) => r.name === name)!
      expect(programRecord, `record ${name} missing from parsed program`).toBeDefined()
      if (recordModesTrustworthy) {
        expect(programRecord.fields, name).toEqual(
          abiRecord.fields.map((f) => ({ name: f.name, type: plaintextToText(f.type, abi.program), visibility: f.mode })),
        )
      } else {
        // Disassembler-produced ABI: field names and types only (modes are
        // wrong upstream — see the fixture table comment).
        expect(programRecord.fields.map(({ name: n, type }) => ({ name: n, type })), name).toEqual(
          abiRecord.fields.map((f) => ({ name: f.name, type: plaintextToText(f.type, abi.program) })),
        )
      }
    }
  })

  it('hasFinalize agrees with isFinal for every function', () => {
    for (const abiFn of abi.functions) {
      const programFn = program.functions.find((f) => f.name === abiFn.name)!
      expect(programFn.hasFinalize, abiFn.name).toBe(abiFn.isFinal)
    }
  })
})

describe('parseProgram / parseAbi parity: getContract encoding', () => {
  it('encodes numeric inputs identically through both artifacts', async () => {
    const { abi, program } = loadPair('compliant_token_template')
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
