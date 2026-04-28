import type { PublicClient } from '../clients/createPublicClient.js'
import type { WalletClient } from '../clients/createWalletClient.js'
import type { Program, ProgramFunction, ProgramMapping } from '../types/program.js'
import type { ABI, AbiFunction, Mapping as AbiMapping } from '../types/abi.js'
import type { RecordValue, Primitive } from '../types/primitives.js'
import { parseProgram } from './parseProgram.js'
import { encodeValue } from '../utils/values.js'
import { encodeInputs, getRecordDef, parseRecordPlaintext, parseRecordPlaintextLoose, toString as serializeRecord } from '../utils/records.js'

import type { InputValue } from '../types/contract.js'
export type { InputValue } from '../types/contract.js'

/** Parsed output from the proxy — either a RecordValue (if it looks like a record) or the raw string */
export type ParsedOutput = RecordValue | string

// ── Parameter types ───────────────────────────────────────────────────

export type GetContractParameters = {
  program: string
  /** Parsed ABI (Mia's ABI type) or legacy Program — if not provided, dynamic proxies are used */
  abi?: ABI | Program | undefined
  /** Program source code — needed for proving/simulation (snarkvm requires source) */
  programSource?: string | undefined
  /** Import program sources — map of program ID to source code */
  imports?: Record<string, string> | undefined
  client:
    | PublicClient
    | WalletClient
    | { public: PublicClient; wallet: WalletClient }
}

export type ContractReadMethods = Record<string, (params: { key: string }) => Promise<unknown>>

export type ContractWriteParams = { inputs: InputValue[]; fee?: bigint; imports?: Record<string, string> }
export type ContractWriteMethods = Record<string, (params: ContractWriteParams) => Promise<string>>

export type ContractSimulateParams = { inputs: InputValue[]; imports?: Record<string, string> }
export type ContractSimulateMethods = Record<string, (params: ContractSimulateParams) => Promise<{ outputs: ParsedOutput[] }>>

export type ContractExecuteParams = { inputs: InputValue[]; fee?: bigint; imports?: Record<string, string> }
export type ContractExecuteMethods = Record<string, (params: ContractExecuteParams) => Promise<{ transactionId: string; outputs: ParsedOutput[] }>>

export type ContractInstance = {
  program: string
  abi: ABI | Program | undefined
  read: ContractReadMethods
  write: ContractWriteMethods
  /** Execute locally and return parsed outputs without broadcasting (local accounts only) */
  simulate: ContractSimulateMethods
  /** Build, broadcast, wait for confirmation, and return parsed outputs */
  execute: ContractExecuteMethods
  /** Fetch and parse the on-chain program source, populating the abi */
  fetchAbi: () => Promise<Program>
}

// ── ABI detection ─────────────────────────────────────────────────────

/** Detect whether the abi is Mia's ABI type (has `functions` with `isFinal`) vs legacy Program */
function isABI(abi: ABI | Program): abi is ABI {
  const first = (abi as ABI).functions?.[0]
  return first !== undefined && 'isFinal' in first
}

// ── Implementation ────────────────────────────────────────────────────

export function getContract(params: GetContractParameters): ContractInstance {
  const { program, abi, programSource, imports: contractImports } = params

  const publicClient = 'getBlockNumber' in params.client
    ? params.client as PublicClient
    : 'public' in params.client
      ? params.client.public
      : undefined

  const walletClient = 'writeContract' in params.client
    ? params.client as WalletClient
    : 'wallet' in params.client
      ? params.client.wallet
      : undefined

  // Extract function/mapping names for validation
  let functionNames: Set<string> | null = null
  let mappingNames: Set<string> | null = null
  let resolvedAbi: ABI | null = null

  if (abi) {
    if (isABI(abi)) {
      resolvedAbi = abi
      functionNames = new Set(abi.functions.map((f: AbiFunction) => f.name))
      mappingNames = new Set(abi.mappings.map((m: AbiMapping) => m.name))
    } else {
      functionNames = new Set(abi.functions.map((f: ProgramFunction) => f.name))
      mappingNames = new Set(abi.mappings.map((m: ProgramMapping) => m.name))
    }
  }

  /** Validate function name against ABI, throw if invalid */
  function validateFunction(prop: string) {
    if (functionNames && !functionNames.has(prop)) {
      throw new Error(
        `Function "${prop}" does not exist on program "${program}". ` +
        `Available functions: ${[...functionNames].join(', ') || 'none'}`,
      )
    }
  }

  /** Auto-encode inputs: native JS values → Aleo strings */
  function resolveInputs(values: InputValue[], fnName: string): string[] {
    // If we have the rich ABI, use encodeInputs with Plaintext types
    if (resolvedAbi) {
      return encodeInputs(values, resolvedAbi, fnName)
    }

    // Legacy Program ABI — use string type hints
    const legacyFn = (abi as Program | undefined)?.functions.find((f) => f.name === fnName)
    return values.map((value, i) => {
      if (typeof value === 'object' && value !== null && 'owner' in value && 'fields' in value) {
        return serializeRecord(value as RecordValue)
      }
      if (typeof value === 'string') return value
      if (typeof value === 'boolean') return String(value)
      if (typeof value === 'bigint' || typeof value === 'number') {
        const type = legacyFn?.inputs[i]?.type as Primitive | undefined
        if (type) return encodeValue(typeof value === 'number' ? BigInt(value) : value, type)
        return String(value)
      }
      return String(value)
    })
  }

  /** Parse raw output strings — detect records and parse them */
  function parseOutputs(rawOutputs: string[], fnName: string): ParsedOutput[] {
    // If we have the rich ABI, try to find RecordDefs for typed parsing
    if (resolvedAbi) {
      const fn = resolvedAbi.functions.find((f) => f.name === fnName)
      return rawOutputs.map((raw, i) => {
        if (!raw.trimStart().startsWith('{')) return raw

        // Check if this output is a known record type
        const outputDef = fn?.outputs[i]
        if (outputDef?.type.kind === 'record') {
          const recordName = outputDef.type.path[outputDef.type.path.length - 1]
          if (recordName) {
            try {
              const recordDef = getRecordDef(resolvedAbi!, recordName)
              return parseRecordPlaintext(raw, recordDef, program)
            } catch {
              // Record not found in this program's ABI (cross-program), fall back to loose
            }
          }
        }
        return parseRecordPlaintextLoose(raw, program)
      })
    }

    // Legacy or no ABI — loose parse for anything that looks like a record
    return rawOutputs.map((raw) => {
      if (raw.trimStart().startsWith('{')) {
        return parseRecordPlaintextLoose(raw, program)
      }
      return raw
    })
  }

  const read = new Proxy({} as ContractReadMethods, {
    get(_target, prop: string) {
      if (typeof prop === 'symbol') return undefined
      if (!publicClient) {
        return () => {
          throw new Error(
            `Cannot read mapping "${prop}" — no public client provided. ` +
            'Pass a PublicClient or { public: publicClient } to getContract.',
          )
        }
      }
      if (mappingNames && !mappingNames.has(prop)) {
        return () => {
          throw new Error(
            `Mapping "${prop}" does not exist on program "${program}". ` +
            `Available mappings: ${[...mappingNames].join(', ') || 'none'}`,
          )
        }
      }
      return (readParams: { key: string }) =>
        publicClient.readContract({
          program,
          mapping: prop,
          key: readParams.key,
        })
    },
  })

  const write = new Proxy({} as ContractWriteMethods, {
    get(_target, prop: string) {
      if (typeof prop === 'symbol') return undefined
      if (!walletClient) {
        return () => { throw new Error(`Cannot call function "${prop}" — no wallet client provided.`) }
      }
      return (writeParams: ContractWriteParams) => {
        validateFunction(prop)
        return walletClient.writeContract({
          program,
          function: prop,
          inputs: resolveInputs(writeParams.inputs, prop),
          fee: writeParams.fee ?? 0n,
        })
      }
    },
  })

  const simulate = new Proxy({} as ContractSimulateMethods, {
    get(_target, prop: string) {
      if (typeof prop === 'symbol') return undefined
      if (!walletClient) {
        return () => { throw new Error(`Cannot simulate function "${prop}" — no wallet client provided.`) }
      }
      return async (simParams: ContractSimulateParams) => {
        validateFunction(prop)
        const result = await walletClient.simulateContract({
          program,
          function: prop,
          inputs: resolveInputs(simParams.inputs, prop),
          programSource,
          imports: { ...contractImports, ...simParams.imports },
        })
        return { outputs: parseOutputs(result.outputs, prop) }
      }
    },
  })

  const execute = new Proxy({} as ContractExecuteMethods, {
    get(_target, prop: string) {
      if (typeof prop === 'symbol') return undefined
      if (!walletClient) {
        return () => { throw new Error(`Cannot execute function "${prop}" — no wallet client provided.`) }
      }
      return async (execParams: ContractExecuteParams) => {
        validateFunction(prop)
        const result = await walletClient.executeTransaction({
          program,
          function: prop,
          inputs: resolveInputs(execParams.inputs, prop),
          fee: execParams.fee,
          programSource,
          imports: { ...contractImports, ...execParams.imports },
        })
        return { transactionId: result.transactionId, outputs: parseOutputs(result.outputs, prop) }
      }
    },
  })

  let cachedAbi = abi

  return {
    program,
    get abi() { return cachedAbi },
    read,
    write,
    simulate,
    execute,
    async fetchAbi() {
      if (!publicClient) {
        throw new Error('Cannot fetch ABI — no public client provided.')
      }
      const source = await publicClient.getCode({ program })
      cachedAbi = parseProgram(source)
      return cachedAbi
    },
  }
}
