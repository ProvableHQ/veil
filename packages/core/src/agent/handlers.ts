import type { PublicClient } from '../clients/createPublicClient.js'
import type { WalletClient } from '../clients/createWalletClient.js'
import type { AgentToolHandler } from './types.js'
import { parseProgram } from '../contract/parseProgram.js'

// ---------------------------------------------------------------------------
// Public (read-only) handlers
// ---------------------------------------------------------------------------

/**
 * Builds the handlers for the read-only tools, keyed by tool name.
 *
 * Construction is pure and local; each handler hits the network through
 * `client` when invoked and resolves to structured JSON matching its schema
 * in `publicToolSchemas`. Most callers get these pre-wired via
 * `aleoAgentTools` or `createAgentTools`; reach for this directly only when
 * pairing handlers with schemas yourself.
 *
 * @param client Public client whose transport serves every read.
 * @returns One handler per tool in `publicToolSchemas`, keyed by tool name
 *   (`aleo_get_balance`, `aleo_read_mapping`, ...).
 *
 * @example
 * const handlers = createPublicHandlers(client)
 * const result = await handlers.aleo_get_balance!({ address: 'aleo1...' })
 */
export function createPublicHandlers(client: PublicClient): Record<string, AgentToolHandler> {
  return {
    aleo_get_block_number: async () => {
      const height = await client.getBlockNumber()
      return { height: String(height) }
    },

    aleo_get_balance: async (input) => {
      const balance = await client.getBalance({ address: input.address as string })
      return { balance: String(balance), unit: 'microcredits', address: input.address }
    },

    aleo_read_mapping: async (input) => {
      const value = await client.readContract({
        programId: input.program as string,
        mapping: input.mapping as string,
        key: input.key as string,
      })
      return {
        value,
        program: input.program,
        mapping: input.mapping,
        key: input.key,
      }
    },

    aleo_get_program: async (input) => {
      const source = await client.getCode({ programId: input.program as string })
      return { source, program: input.program }
    },

    aleo_get_block: async (input) => {
      const block = await client.getBlock({
        height: input.height as number | undefined,
        hash: input.hash as string | undefined,
      })
      return { block }
    },

    aleo_get_transaction: async (input) => {
      const transaction = await client.getTransaction({ id: input.id as string })
      return { transaction }
    },

    aleo_describe_program: async (input) => {
      const source = await client.getCode({ programId: input.program as string })
      const parsed = parseProgram(source)
      return {
        program: parsed.id,
        functions: parsed.functions.map((f) => ({
          name: f.name,
          inputs: f.inputs,
          outputs: f.outputs,
          hasFinalize: f.hasFinalize,
        })),
        mappings: parsed.mappings.map((m) => ({
          name: m.name,
          keyType: m.keyType,
          valueType: m.valueType,
        })),
        closures: parsed.closures,
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Wallet (write) handlers
// ---------------------------------------------------------------------------

/**
 * Builds the handlers for the write tools, keyed by tool name.
 *
 * Construction is pure and local; each handler signs, proves, and submits a
 * fee-paying transaction through `walletClient` when invoked, resolving to
 * `{ transactionId }` with the `at1...` ID. Most callers get these pre-wired
 * via `aleoAgentTools` or `createAgentTools`.
 *
 * @param walletClient Wallet client whose account signs and pays for every call.
 * @returns One handler per tool in `walletToolSchemas`, keyed by tool name
 *   (`aleo_execute`, `aleo_transfer`, `aleo_deploy`).
 *
 * @example
 * const handlers = createWalletHandlers(walletClient)
 * const result = await handlers.aleo_transfer!({ to: 'aleo1...', amount: 1_000_000 })
 */
export function createWalletHandlers(walletClient: WalletClient): Record<string, AgentToolHandler> {
  return {
    aleo_execute: async (input) => {
      const txId = await walletClient.writeContract({
        program: input.program as string,
        function: input.function as string,
        inputs: input.inputs as string[],
        privateFee: input.privateFee as boolean | undefined,
        imports: input.imports as string[] | undefined,
      })
      return { transactionId: txId }
    },

    aleo_transfer: async (input) => {
      const txId = await walletClient.transfer({
        to: input.to as string,
        amount: BigInt(input.amount as number),
      })
      return { transactionId: txId }
    },

    aleo_deploy: async (input) => {
      const txId = await walletClient.deployContract({
        program: input.program as string,
        privateFee: input.privateFee as boolean | undefined,
      })
      return { transactionId: txId }
    },
  }
}
