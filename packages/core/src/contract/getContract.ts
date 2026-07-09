import type { PublicClient } from '../clients/createPublicClient.js'
import type { WalletClient } from '../clients/createWalletClient.js'
import type { Program, ProgramFunction, ProgramMapping } from '../types/program.js'
import type { ABI, AbiFunction, Mapping as AbiMapping } from '../types/abi.js'
import type { TypedContractInstance } from '../types/inference.js'
import type { RecordValue, Primitive } from '../types/primitives.js'
import { parseProgram } from './parseProgram.js'
import { encodeValue } from '../utils/values.js'
import { encodeInputs, getInputTypes, getRecordDef, parseRecordPlaintext, parseRecordPlaintextLoose, toString as serializeRecord } from '../utils/records.js'

import type { InputValue } from '../types/contract.js'
export type { InputValue } from '../types/contract.js'
import { isInputRequest } from '../types/inputRequest.js'
import type { InputRequest, TransactionInput } from '../types/inputRequest.js'

/** Parsed output from the proxy — either a RecordValue (if it looks like a record) or the raw string */
export type ParsedOutput = RecordValue | string

// ── Parameter types ───────────────────────────────────────────────────

/**
 * Configuration passed to {@link getContract} to bind a program to a client.
 *
 * @property program On-chain program ID the instance targets, such as `"credits.aleo"`.
 * @property abi Parsed ABI or legacy Program used to validate method names and
 *   type inputs and outputs. When omitted, method names are not validated and
 *   values pass through the dynamic proxies unencoded. Defaults to undefined.
 * @property programSource Program source code, required for local proving and
 *   simulation because snarkVM needs the source. Defaults to undefined.
 * @property imports Map of imported program ID to its source code, needed when a
 *   called function depends on other programs during proving. Defaults to undefined.
 * @property client Client backing reads and writes: a `PublicClient` for reads
 *   only, a `WalletClient` for writes only, or `{ public, wallet }` for both.
 */
export type GetContractParameters = {
  program: string
  abi?: ABI | Program | undefined
  programSource?: string | undefined
  imports?: Record<string, string> | undefined
  client:
    | PublicClient
    | WalletClient
    | { public: PublicClient; wallet: WalletClient }
}

/** Mapping-name-keyed read methods that fetch an on-chain mapping value by key. */
export type ContractReadMethods = Record<string, (params: { key: string }) => Promise<unknown>>

/**
 * Arguments to a contract write method.
 *
 * @property inputs Ordered function inputs. Native JS values are auto-encoded to
 *   Aleo strings against the ABI; `InputRequest`s are passed through for the
 *   wallet to fulfill.
 * @property imports Optional per-call imported program sources, merged over the
 *   instance-level imports. Defaults to undefined.
 */
export type ContractWriteParams = { inputs: (InputValue | InputRequest)[]; imports?: Record<string, string> }

/** Function-name-keyed write methods that build, sign, and broadcast a transaction, resolving to its transaction id. */
export type ContractWriteMethods = Record<string, (params: ContractWriteParams) => Promise<string>>

/**
 * Parsed outputs of a single transition within a simulated or executed transaction.
 *
 * @property transitionId On-chain transition id.
 * @property program Program ID the transition ran against.
 * @property function Function name the transition invoked.
 * @property outputs Transition outputs, parsed to `RecordValue` where an output
 *   looks like a record and left as the raw string otherwise.
 */
export type ContractTransitionResult = { transitionId: string; program: string; function: string; outputs: ParsedOutput[] }

/**
 * Arguments to a contract simulate method.
 *
 * @property inputs Ordered function inputs, encoded as for {@link ContractWriteParams}.
 * @property imports Optional per-call imported program sources, merged over the
 *   instance-level imports. Defaults to undefined.
 */
export type ContractSimulateParams = { inputs: (InputValue | InputRequest)[]; imports?: Record<string, string> }

/**
 * Result of a local simulation.
 *
 * @property transitions Parsed results for every transition the call produced,
 *   including nested foreign-program transitions.
 * @property outputs Parsed outputs of the called function's own transition.
 */
export type ContractSimulateResult = { transitions: ContractTransitionResult[]; outputs: ParsedOutput[] }

/** Function-name-keyed simulate methods that prove locally and return parsed outputs without broadcasting. */
export type ContractSimulateMethods = Record<string, (params: ContractSimulateParams) => Promise<ContractSimulateResult>>

/**
 * Arguments to a contract execute method.
 *
 * @property inputs Ordered function inputs, encoded as for {@link ContractWriteParams}.
 * @property imports Optional per-call imported program sources, merged over the
 *   instance-level imports. Defaults to undefined.
 */
export type ContractExecuteParams = { inputs: (InputValue | InputRequest)[]; imports?: Record<string, string> }

/**
 * Result of an on-chain execution.
 *
 * @property transactionId Id of the broadcast, confirmed transaction.
 * @property transitions Parsed results for every transition the call produced,
 *   including nested foreign-program transitions.
 * @property outputs Parsed outputs of the called function's own transition.
 */
export type ContractExecuteResult = { transactionId: string; transitions: ContractTransitionResult[]; outputs: ParsedOutput[] }

/** Function-name-keyed execute methods that build, broadcast, wait for confirmation, and return parsed outputs. */
export type ContractExecuteMethods = Record<string, (params: ContractExecuteParams) => Promise<ContractExecuteResult>>

/**
 * A program bound to a client, exposing its mappings and functions as callable methods.
 *
 * Returned by {@link getContract} when no rich ABI is supplied; a typed instance
 * is returned instead when the ABI is known at compile time.
 *
 * @property program On-chain program ID the instance targets.
 * @property abi ABI or legacy Program backing method-name validation, or
 *   undefined when none was supplied. Updated in place by `fetchAbi`.
 * @property read Mapping reads keyed by mapping name. Requires a public client.
 * @property write Function calls keyed by function name that broadcast a
 *   transaction. Requires a wallet client.
 * @property simulate Local proving keyed by function name that returns parsed
 *   outputs without broadcasting (local accounts only). Requires a wallet client.
 * @property execute Function calls keyed by function name that broadcast, wait
 *   for confirmation, and return parsed outputs. Requires a wallet client.
 * @property fetchAbi Fetches the on-chain program source, parses it, and caches
 *   the result as `abi`. Hits the network and requires a public client.
 */
export type ContractInstance = {
  program: string
  abi: ABI | Program | undefined
  read: ContractReadMethods
  write: ContractWriteMethods
  simulate: ContractSimulateMethods
  execute: ContractExecuteMethods
  fetchAbi: () => Promise<Program>
}

// ── ABI detection ─────────────────────────────────────────────────────

/** Detect whether the abi is a parsed ABI (has `structs`) vs legacy Program */
function isABI(abi: ABI | Program): abi is ABI {
  return 'structs' in abi
}

// ── Implementation ────────────────────────────────────────────────────

/**
 * Binds an Aleo program to a client, exposing its mappings and functions as callable methods.
 *
 * Use for interacting with a program by name instead of assembling raw
 * `readContract`/`writeContract` calls: `contract.read.<mapping>` fetches mapping
 * values, `contract.write.<function>` broadcasts a transaction, `contract.simulate`
 * proves locally, and `contract.execute` broadcasts and waits. When a rich ABI is
 * passed as a `const`, the returned instance is statically typed to the program's
 * mappings and functions; otherwise the methods are dynamic proxies.
 *
 * Construction is pure and local — the network is only touched when a method is
 * called. Read methods need a public client, write/simulate/execute need a wallet
 * client, and simulation/proving additionally needs `programSource`.
 *
 * @param params Program ID, optional ABI and sources, and the backing client.
 * @returns A contract instance whose `read`/`write`/`simulate`/`execute` methods
 *   are keyed by mapping and function name, typed to the ABI when one is supplied.
 * @throws When a method is invoked whose name is absent from the supplied ABI, or
 *   when the required client (public for reads, wallet for writes) was not provided.
 *
 * @example
 * import { createPublicClient, http, parseProgram, getContract } from '@provablehq/veil-core'
 *
 * const client = createPublicClient({ transport: http('https://api.provable.com/v2', { network: 'mainnet' }) })
 * const source = await client.getCode({ programId: 'credits.aleo' })
 * const credits = getContract({ program: 'credits.aleo', abi: parseProgram(source), client })
 *
 * const balance = await credits.read.account({ key: 'aleo1…' })
 */
export function getContract<const A extends ABI | Program | undefined = undefined>(
  params: GetContractParameters & { abi?: A },
): A extends ABI ? TypedContractInstance<A & ABI> : ContractInstance
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

  /** Auto-encode inputs: native JS values → Aleo strings. InputRequests pass through un-encoded. */
  function resolveInputs(values: (InputValue | InputRequest)[], fnName: string): TransactionInput[] {
    const legacyFn = (abi as Program | undefined)?.functions.find((f) => f.name === fnName)

    // Encode a single literal value at position `i` (legacy / no-ABI path).
    const encodeOne = (value: InputValue, i: number): string => {
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
    }

    // Fast path: no wallet-fulfilled requests — encode exactly as before.
    if (!values.some(isInputRequest)) {
      if (resolvedAbi) return encodeInputs(values as InputValue[], resolvedAbi, fnName)
      return (values as InputValue[]).map(encodeOne)
    }

    // Mixed path: pass requests through untouched; encode each literal at its position.
    const types = resolvedAbi ? getInputTypes(resolvedAbi, fnName) : undefined
    return values.map((value, i): TransactionInput => {
      if (isInputRequest(value)) return value
      const literal = value as InputValue
      const type = types?.[i]
      if (type) return encodeInputs([literal], [type])[0]!
      return encodeOne(literal, i)
    })
  }

  /** Parse raw output strings — detect records and parse them */
  function parseOutputs(rawOutputs: string[], fnName: string): ParsedOutput[] {
    // With a rich ABI, look up RecordDefs for typed parsing
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

  /** Loose-parse a single output — try record detection, fall back to raw string */
  function parseLooseOutput(raw: string): ParsedOutput {
    if (raw.trimStart().startsWith('{')) {
      return parseRecordPlaintextLoose(raw)
    }
    return raw
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
          programId: program,
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
      if (functionNames && !functionNames.has(prop)) {
        return () => {
          throw new Error(
            `Function "${prop}" does not exist on program "${program}". ` +
            `Available functions: ${[...functionNames].join(', ') || 'none'}`,
          )
        }
      }
      return (writeParams: ContractWriteParams) => {
        validateFunction(prop)
        return walletClient.writeContract({
          program,
          function: prop,
          inputs: resolveInputs(writeParams.inputs, prop),
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

        // Build per-transition parsed results.
        // Same-program transitions: parse with local ABI. Foreign: loose parse.
        const transitions: ContractTransitionResult[] = (result.transitions ?? []).map(t => ({
          transitionId: t.transitionId,
          program: t.program,
          function: t.function,
          outputs: t.program === program
            ? parseOutputs(t.outputs, t.function)
            : t.outputs.map(o => parseLooseOutput(o)),
        }))

        // Raw `outputs` is already the called function's transition outputs.
        const outputs = parseOutputs(result.outputs, prop)

        return { transitions, outputs }
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
        const result = await walletClient.executeContract({
          program,
          function: prop,
          inputs: resolveInputs(execParams.inputs, prop),
          programSource,
          imports: { ...contractImports, ...execParams.imports },
        })

        // Build per-transition parsed results.
        // Same-program transitions: parse with local ABI. Foreign: loose parse.
        const transitions: ContractTransitionResult[] = (result.transitions ?? []).map(t => ({
          transitionId: t.transitionId,
          program: t.program,
          function: t.function,
          outputs: t.program === program
            ? parseOutputs(t.outputs, t.function)
            : t.outputs.map(o => parseLooseOutput(o)),
        }))

        // Raw `outputs` is already the called function's transition outputs (set by extractTransitions).
        const outputs = parseOutputs(result.outputs, prop)

        return { transactionId: result.transactionId, transitions, outputs }
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
      const source = await publicClient.getCode({ programId: program })
      cachedAbi = parseProgram(source)
      return cachedAbi
    },
  }
}
