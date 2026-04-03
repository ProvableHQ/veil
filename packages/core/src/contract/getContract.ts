import type { Client } from '../clients/createClient.js'
import type { PublicClient } from '../clients/createPublicClient.js'
import type { WalletClient } from '../clients/createWalletClient.js'
import type { Program, ProgramFunction, ProgramMapping } from '../types/program.js'
import { parseProgram } from './parseProgram.js'

export type GetContractParameters = {
  program: string
  /** Pre-parsed program — if not provided, getContract creates dynamic proxies */
  abi?: Program | undefined
  client:
    | PublicClient
    | WalletClient
    | { public: PublicClient; wallet: WalletClient }
}

export type ContractReadMethods = Record<string, (params: { key: string }) => Promise<unknown>>

export type ContractWriteMethods = Record<string, (params: { inputs: string[]; fee?: bigint }) => Promise<string>>

export type ContractInstance = {
  program: string
  abi: Program | undefined
  read: ContractReadMethods
  write: ContractWriteMethods
  /** Fetch and parse the on-chain program source, populating the abi */
  fetchAbi: () => Promise<Program>
}

/**
 * Creates a contract instance bound to a program and client(s).
 *
 * Read methods map to program mappings via readContract.
 * Write methods map to program functions via writeContract.
 *
 * If an `abi` (parsed Program) is provided, method access is validated
 * against the actual program definition. Otherwise, dynamic proxies
 * allow any method name (useful for quick prototyping).
 */
export function getContract(params: GetContractParameters): ContractInstance {
  const { program, abi } = params

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
      return (writeParams: { inputs: string[]; fee?: bigint }) =>
        walletClient.writeContract({
          program,
          function: prop,
          inputs: writeParams.inputs,
          fee: writeParams.fee ?? 0n,
        })
    },
  })

  let cachedAbi = abi

  return {
    program,
    get abi() { return cachedAbi },
    read,
    write,
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
