import type { ProgramFunction, ProgramRegister } from '../types/program.js'
import { parseProgram } from './parseProgram.js'

/** ARC token standard a program can be checked against. */
export type ArcStandard = 'arc20' | 'arc22'

/**
 * One way a program deviates from an ARC interface. `expected` and `actual`
 * are bytecode-style type strings including visibility (e.g. `address.public`,
 * `Token.record`, `[MerkleProof; 2u32].private`, `future`); `undefined` marks
 * a register position that one side does not have.
 */
export type ArcViolation =
  | { kind: 'missing_function'; name: string }
  | { kind: 'missing_view'; name: string }
  | { kind: 'missing_record'; name: string }
  | { kind: 'input_mismatch'; fn: string; index: number; expected: string | undefined; actual: string | undefined }
  | { kind: 'output_mismatch'; fn: string; index: number; expected: string | undefined; actual: string | undefined }
  | { kind: 'record_field_mismatch'; record: string; field: string; expected: string; actual: string | undefined }

/**
 * Result of checking a program against an ARC token interface.
 *
 * @property programId Program id parsed from the source text.
 * @property standard The interface the program was checked against.
 * @property conforms True when the program satisfies every interface rule.
 * @property violations Every deviation found; empty when `conforms` is true.
 */
export type ArcConformanceReport = {
  programId: string
  standard: ArcStandard
  conforms: boolean
  violations: ArcViolation[]
}

type CallableSpec = { inputs: string[]; outputs: string[] }

type InterfaceSpec = {
  functions: Record<string, CallableSpec>
  views: Record<string, CallableSpec>
  records: Record<string, Record<string, string>>
  structs: Record<string, Record<string, string>>
}

// The seven read accessors both standards require.
const ARC_VIEWS: Record<string, CallableSpec> = {
  balance_of: { inputs: ['address.public'], outputs: ['u128.public'] },
  allowance: { inputs: ['address.public', 'address.public'], outputs: ['u128.public'] },
  supply: { inputs: [], outputs: ['u128.public'] },
  max_supply: { inputs: [], outputs: ['u128.public'] },
  decimals: { inputs: [], outputs: ['u8.public'] },
  name: { inputs: [], outputs: ['identifier.public'] },
  symbol: { inputs: [], outputs: ['identifier.public'] },
}

const TOKEN_RECORD: Record<string, string> = {
  owner: 'address.private',
  amount: 'u128.private',
}

// Functions whose signatures ARC-20 and ARC-22 share verbatim.
const SHARED_FUNCTIONS: Record<string, CallableSpec> = {
  transfer_public: { inputs: ['address.public', 'u128.public'], outputs: ['future'] },
  transfer_public_as_signer: { inputs: ['address.public', 'u128.public'], outputs: ['future'] },
  transfer_from_public: { inputs: ['address.public', 'address.public', 'u128.public'], outputs: ['future'] },
  approve_public: { inputs: ['address.public', 'u128.public'], outputs: ['future'] },
  unapprove_public: { inputs: ['address.public', 'u128.public'], outputs: ['future'] },
  join: { inputs: ['Token.record', 'Token.record'], outputs: ['Token.record'] },
  split: { inputs: ['Token.record', 'u128.private'], outputs: ['Token.record', 'Token.record'] },
}

const IARC20: InterfaceSpec = {
  functions: {
    ...SHARED_FUNCTIONS,
    transfer_private: {
      inputs: ['Token.record', 'address.private', 'u128.private'],
      outputs: ['Token.record', 'Token.record'],
    },
    transfer_private_to_public: {
      inputs: ['Token.record', 'address.public', 'u128.public'],
      outputs: ['Token.record', 'future'],
    },
    transfer_public_to_private: {
      inputs: ['address.private', 'u128.public'],
      outputs: ['Token.record', 'future'],
    },
    transfer_from_public_to_private: {
      inputs: ['address.public', 'address.private', 'u128.public'],
      outputs: ['Token.record', 'future'],
    },
  },
  views: ARC_VIEWS,
  records: { Token: TOKEN_RECORD },
  structs: {},
}

const IARC22: InterfaceSpec = {
  functions: {
    ...SHARED_FUNCTIONS,
    transfer_private: {
      inputs: ['address.private', 'u128.private', 'Token.record', '[MerkleProof; 2u32].private'],
      outputs: ['ComplianceRecord.record', 'Token.record', 'Token.record', 'future'],
    },
    transfer_private_to_public: {
      inputs: ['address.public', 'u128.public', 'Token.record', '[MerkleProof; 2u32].private'],
      outputs: ['ComplianceRecord.record', 'Token.record', 'future'],
    },
    transfer_public_to_private: {
      inputs: ['address.private', 'u128.public'],
      outputs: ['ComplianceRecord.record', 'Token.record', 'future'],
    },
    transfer_from_public_to_private: {
      inputs: ['address.public', 'address.private', 'u128.public'],
      outputs: ['ComplianceRecord.record', 'Token.record', 'future'],
    },
  },
  views: ARC_VIEWS,
  records: {
    Token: TOKEN_RECORD,
    ComplianceRecord: {
      owner: 'address.private',
      amount: 'u128.private',
      sender: 'address.private',
      recipient: 'address.private',
    },
  },
  structs: {
    MerkleProof: { siblings: '[field; 16u32]', leaf_index: 'u32' },
  },
}

const INTERFACES: Record<ArcStandard, InterfaceSpec> = { arc20: IARC20, arc22: IARC22 }

// Normalizes one parsed register to a bytecode-style comparison string.
// Futures collapse to 'future'; program qualifiers on imported types are
// stripped so `freezelist.aleo/MerkleProof` compares equal to `MerkleProof`.
function canonicalType(register: ProgramRegister): string {
  switch (register.kind) {
    case 'future':
      return 'future'
    case 'dynamicRecord':
      return 'dynamic.record'
    case 'dynamicFuture':
      return 'dynamic.future'
    default: {
      const type = register.type.replace(/\b[a-z][a-z0-9_]*\.aleo\//g, '')
      return register.kind === 'record' ? `${type}.record` : `${type}.${register.visibility}`
    }
  }
}

// Compares one register list (inputs or outputs) position by position against
// the interface's expected types; `undefined` marks a position only one side has.
function checkRegisters(
  kind: 'input_mismatch' | 'output_mismatch',
  fn: string,
  expectedTypes: string[],
  registers: ProgramFunction['inputs'] | ProgramFunction['outputs'],
  violations: ArcViolation[],
): void {
  const count = Math.max(expectedTypes.length, registers.length)
  for (let i = 0; i < count; i++) {
    const expected = expectedTypes[i]
    const actual = registers[i] ? canonicalType(registers[i]!) : undefined
    if (expected !== actual) {
      violations.push({ kind, fn, index: i, expected, actual })
    }
  }
}

function checkCallables(
  specs: Record<string, CallableSpec>,
  actuals: ProgramFunction[],
  missingKind: 'missing_function' | 'missing_view',
  violations: ArcViolation[],
): void {
  for (const [name, spec] of Object.entries(specs)) {
    const fn = actuals.find((f) => f.name === name)
    if (!fn) {
      violations.push({ kind: missingKind, name })
      continue
    }
    checkRegisters('input_mismatch', name, spec.inputs, fn.inputs, violations)
    checkRegisters('output_mismatch', name, spec.outputs, fn.outputs, violations)
  }
}

// Compares a record's or struct's fields against the expected field types.
// `actualFields` maps field name to its canonical type string; a missing
// entry reports `actual: undefined`.
function checkFields(
  container: string,
  expectedFields: Record<string, string>,
  actualFields: Map<string, string>,
  violations: ArcViolation[],
): void {
  for (const [field, expected] of Object.entries(expectedFields)) {
    const actual = actualFields.get(field)
    if (actual !== expected) {
      violations.push({ kind: 'record_field_mismatch', record: container, field, expected, actual })
    }
  }
}

/**
 * Checks Aleo program source against an ARC token interface and reports every
 * deviation. Pure and local — no network access; the caller supplies the
 * program text (see the `checkArcConformance` action to fetch by program id).
 *
 * Matching is structural and strict: functions and views are looked up by
 * name, then every input and output register position must carry the exact
 * type and visibility the interface declares. Extra functions, views, record
 * fields, mappings, or structs never disqualify a program. The `MerkleProof`
 * struct (ARC-22) is shape-checked only when the program defines it locally;
 * implementations that import it reference the definition of the exporting
 * program instead.
 *
 * @param source Compiled Aleo instructions text of the program.
 * @param standard Interface to check against.
 * @returns The conformance report; `conforms` is true when `violations` is empty.
 *
 * @example
 * const report = checkProgramConformance(source, 'arc20')
 * if (!report.conforms) console.log(report.violations)
 */
export function checkProgramConformance(source: string, standard: ArcStandard): ArcConformanceReport {
  const spec = INTERFACES[standard]
  const program = parseProgram(source)
  const violations: ArcViolation[] = []

  // Required records: named record present with every required field exact.
  for (const [recordName, fields] of Object.entries(spec.records)) {
    const record = program.records.find((r) => r.name === recordName)
    if (!record) {
      violations.push({ kind: 'missing_record', name: recordName })
      continue
    }
    const actualFields = new Map(record.fields.map((f) => [f.name, `${f.type}.${f.visibility}`]))
    checkFields(recordName, fields, actualFields, violations)
  }

  // Interface structs are verified only when defined in this program; imported
  // definitions live in the exporting program and are matched by name in
  // signatures instead.
  for (const [structName, fields] of Object.entries(spec.structs)) {
    const struct = program.structs.find((s) => s.name === structName)
    if (!struct) continue
    checkFields(structName, fields, new Map(struct.fields.map((f) => [f.name, f.type])), violations)
  }

  checkCallables(spec.functions, program.functions, 'missing_function', violations)
  checkCallables(spec.views, program.views, 'missing_view', violations)

  return { programId: program.id, standard, conforms: violations.length === 0, violations }
}
