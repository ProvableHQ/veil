import type { PublicClient } from '../clients/createPublicClient.js'
import type { WalletClient } from '../clients/createWalletClient.js'
import type { Program, ProgramFunction, ProgramMapping } from '../types/program.js'
import type { RawSimulateResult, RawExecuteResult } from '../types/proving.js'
import { parseProgram } from './parseProgram.js'

export type GetContractParameters = {
  program: string
  /** Pre-parsed program — if not provided, getContract creates dynamic proxies */
  abi?: Program | undefined
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

export type ContractWriteParams = { inputs: string[]; fee?: bigint; imports?: Record<string, string> }
export type ContractWriteMethods = Record<string, (params: ContractWriteParams) => Promise<string>>

export type ContractSimulateParams = { inputs: string[]; imports?: Record<string, string> }
export type ContractSimulateMethods = Record<string, (params: ContractSimulateParams) => Promise<RawSimulateResult>>

export type ContractExecuteParams = { inputs: string[]; fee?: bigint; imports?: Record<string, string> }
export type ContractExecuteMethods = Record<string, (params: ContractExecuteParams) => Promise<RawExecuteResult>>

export type ContractInstance = {
  program: string
  abi: Program | undefined
  read: ContractReadMethods
  write: ContractWriteMethods
  /** Execute locally and return outputs without broadcasting (local accounts only) */
  simulate: ContractSimulateMethods
  /** Build, broadcast, wait for confirmation, and return outputs */
  execute: ContractExecuteMethods
  /** Fetch and parse the on-chain program source, populating the abi */
  fetchAbi: () => Promise<Program>
}

/**
 * Creates a contract instance bound to a program and client(s).
 *
 * Read methods map to program mappings via readContract.
 * Write/simulate/execute methods map to program functions.
 *
 * If an `abi` (parsed Program) is provided, method access is validated
 * against the actual program definition. Otherwise, dynamic proxies
 * allow any method name (useful for quick prototyping).
 */
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

  // Build known names from ABI if available
  const mappingNames = abi ? new Set(abi.mappings.map((m: ProgramMapping) => m.name)) : null
  const functionNames = abi ? new Set(abi.functions.map((f: ProgramFunction) => f.name)) : null

  /** Validate function name against ABI, throw if invalid */
  function validateFunction(prop: string) {
    if (functionNames && !functionNames.has(prop)) {
      throw new Error(
        `Function "${prop}" does not exist on program "${program}". ` +
        `Available functions: ${[...functionNames].join(', ') || 'none'}`,
      )
    }
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
          inputs: writeParams.inputs,
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
      return (simParams: ContractSimulateParams) => {
        validateFunction(prop)
        return walletClient.simulateContract({
          program,
          function: prop,
          inputs: simParams.inputs,
          programSource,
          imports: { ...contractImports, ...simParams.imports },
        })
      }
    },
  })

  const execute = new Proxy({} as ContractExecuteMethods, {
    get(_target, prop: string) {
      if (typeof prop === 'symbol') return undefined
      if (!walletClient) {
        return () => { throw new Error(`Cannot execute function "${prop}" — no wallet client provided.`) }
      }
      return (execParams: ContractExecuteParams) => {
        validateFunction(prop)
        return walletClient.executeTransaction({
          program,
          function: prop,
          inputs: execParams.inputs,
          fee: execParams.fee,
          programSource,
          imports: { ...contractImports, ...execParams.imports },
        })
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
