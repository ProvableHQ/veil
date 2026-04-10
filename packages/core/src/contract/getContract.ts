import type { PublicClient } from '../clients/createPublicClient.js'
import type { WalletClient } from '../clients/createWalletClient.js'
import type { Program, AleoAbi } from '../types/program.js'
import type {
  InputValue,
  TypedSimulateReturn,
} from '../types/abi-types.js'
import { parseProgram } from './parseProgram.js'
import { parseAbi } from './parseAbi.js'
import { encodeInputs, parseOutputs } from '../utils/values.js'

// ── Parameter & return types ──────────────────────────────────────────

export type GetContractParameters = {
  program: string
  /** Pre-parsed program or compiler ABI JSON — if not provided, getContract creates dynamic proxies */
  abi?: Program | AleoAbi | undefined
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
export type ContractSimulateMethods = Record<string, (params: ContractSimulateParams) => Promise<TypedSimulateReturn>>

export type ContractExecuteParams = { inputs: InputValue[]; fee?: bigint; imports?: Record<string, string> }
export type ContractExecuteMethods = Record<string, (params: ContractExecuteParams) => Promise<TypedSimulateReturn & { transactionId: string }>>

export type ContractInstance = {
  program: string
  abi: Program | undefined
  read: ContractReadMethods
  write: ContractWriteMethods
  /** Execute locally and return outputs without broadcasting */
  simulate: ContractSimulateMethods
  /** Build, broadcast, wait for confirmation, and return parsed outputs */
  execute: ContractExecuteMethods
  /** Fetch and parse the on-chain program source, populating the abi */
  fetchAbi: () => Promise<Program>
}

// ── Implementation ────────────────────────────────────────────────────

/** Detect whether an object is a raw AleoAbi JSON (has `transitions`) vs a parsed Program (has `functions`) */
function isAleoAbi(abi: Program | AleoAbi): abi is AleoAbi {
  return 'transitions' in abi
}

/**
 * Creates a contract instance bound to a program and client(s).
 *
 * Read methods map to program mappings via readContract.
 * Write methods map to program functions via writeContract.
 * Simulate methods execute locally and return parsed outputs.
 *
 * When an ABI is provided:
 * - Method names are validated against the program definition
 * - Inputs are auto-encoded (bigint/boolean → Aleo string format)
 * - Outputs are auto-parsed (record strings → typed objects)
 *
 * Without an ABI, dynamic proxies allow any method name with raw string I/O.
 */
export function getContract(params: GetContractParameters): ContractInstance {
  const { program, programSource, imports: contractImports } = params

  // Normalize ABI: accept either compiler JSON or parsed Program
  const resolvedAbi: Program | undefined = params.abi
    ? isAleoAbi(params.abi) ? parseAbi(params.abi) : params.abi
    : undefined

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

  // Build known names from ABI if available
  const mappingNames = resolvedAbi ? new Set(resolvedAbi.mappings.map((m) => m.name)) : null
  const functionNames = resolvedAbi ? new Set(resolvedAbi.functions.map((f) => f.name)) : null

  /** Find the function definition for a given name */
  function findFunction(name: string) {
    return resolvedAbi?.functions.find((f) => f.name === name)
  }

  /** Auto-encode inputs if ABI is available, otherwise pass through */
  function resolveInputs(inputs: InputValue[], fnName: string): string[] {
    const fnDef = findFunction(fnName)
    if (fnDef) {
      return encodeInputs(inputs, fnDef.inputs)
    }
    // No ABI — assume all inputs are already strings
    return inputs.map(String)
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
        return () => {
          throw new Error(
            `Cannot call function "${prop}" — no wallet client provided. ` +
            'Pass a WalletClient or { wallet: walletClient } to getContract.',
          )
        }
      }
      if (functionNames && !functionNames.has(prop)) {
        return () => {
          throw new Error(
            `Function "${prop}" does not exist on program "${program}". ` +
            `Available functions: ${[...functionNames].join(', ') || 'none'}`,
          )
        }
      }
      return (writeParams: ContractWriteParams) =>
        walletClient.writeContract({
          program,
          function: prop,
          inputs: resolveInputs(writeParams.inputs, prop),
          fee: writeParams.fee ?? 0n,
          programSource,
          imports: { ...contractImports, ...writeParams.imports },
        })
    },
  })

  const simulate = new Proxy({} as ContractSimulateMethods, {
    get(_target, prop: string) {
      if (typeof prop === 'symbol') return undefined
      if (!walletClient) {
        return () => {
          throw new Error(
            `Cannot simulate function "${prop}" — no wallet client provided. ` +
            'Pass a WalletClient or { wallet: walletClient } to getContract.',
          )
        }
      }
      if (functionNames && !functionNames.has(prop)) {
        return () => {
          throw new Error(
            `Function "${prop}" does not exist on program "${program}". ` +
            `Available functions: ${[...functionNames].join(', ') || 'none'}`,
          )
        }
      }
      return async (simParams: ContractSimulateParams): Promise<TypedSimulateReturn> => {
        const result = await walletClient.simulateContract({
          program,
          function: prop,
          inputs: resolveInputs(simParams.inputs, prop),
          programSource,
          imports: { ...contractImports, ...simParams.imports },
        })

        // Auto-parse outputs if ABI is available
        const fnDef = findFunction(prop)
        if (fnDef && resolvedAbi) {
          return {
            outputs: parseOutputs(result.outputs, fnDef.outputs, resolvedAbi.records),
          }
        }

        // No ABI — wrap raw strings as value outputs
        return {
          outputs: result.outputs.map((raw) => ({
            type: 'value' as const,
            data: { value: raw, type: 'string' },
          })),
        }
      }
    },
  })

  const execute = new Proxy({} as ContractExecuteMethods, {
    get(_target, prop: string) {
      if (typeof prop === 'symbol') return undefined
      if (!walletClient) {
        return () => {
          throw new Error(
            `Cannot execute function "${prop}" — no wallet client provided. ` +
            'Pass a WalletClient or { wallet: walletClient } to getContract.',
          )
        }
      }
      if (functionNames && !functionNames.has(prop)) {
        return () => {
          throw new Error(
            `Function "${prop}" does not exist on program "${program}". ` +
            `Available functions: ${[...functionNames].join(', ') || 'none'}`,
          )
        }
      }
      return async (execParams: ContractExecuteParams): Promise<TypedSimulateReturn & { transactionId: string }> => {
        const result = await walletClient.executeContract({
          program,
          function: prop,
          inputs: resolveInputs(execParams.inputs, prop),
          fee: execParams.fee,
          programSource,
          imports: { ...contractImports, ...execParams.imports },
        })

        // Auto-parse outputs if ABI is available
        const fnDef = findFunction(prop)
        if (fnDef && resolvedAbi) {
          return {
            transactionId: result.transactionId,
            outputs: parseOutputs(result.outputs, fnDef.outputs, resolvedAbi.records),
          }
        }

        // No ABI — wrap raw strings as value outputs
        return {
          transactionId: result.transactionId,
          outputs: result.outputs.map((raw) => ({
            type: 'value' as const,
            data: { value: raw, type: 'string' },
          })),
        }
      }
    },
  })

  let cachedAbi = resolvedAbi

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
