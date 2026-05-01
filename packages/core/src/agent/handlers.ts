import type { PublicClient } from '../clients/createPublicClient.js'
import type { WalletClient } from '../clients/createWalletClient.js'
import type { AgentToolHandler } from './types.js'
import { parseProgram } from '../contract/parseProgram.js'

// ---------------------------------------------------------------------------
// Public (read-only) handlers
// ---------------------------------------------------------------------------

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
