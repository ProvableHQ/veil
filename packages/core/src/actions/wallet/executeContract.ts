import { AccountNotFoundError, ProvingNotConfiguredError } from '../../errors/errors.js'
import type { Client } from '../../clients/createClient.js'
import type { ExecuteResult } from '../../types/proving.js'

export type ExecuteContractParameters = {
  program: string
  function: string
  inputs: string[]
  fee?: bigint
  privateFee?: boolean
  programSource?: string
  imports?: Record<string, string>
}

export type ExecuteContractReturnType = ExecuteResult

/**
 * Executes a program function end-to-end: build, prove, broadcast, wait for
 * confirmation, and return parsed outputs.
 *
 * In local mode, this simulates locally (same as simulateContract) and returns
 * the outputs without broadcasting.
 *
 * In delegated mode, this submits to the proving service, waits for the
 * transaction to confirm on-chain, and extracts/decrypts the output records.
 *
 * This is the "do the whole thing" action — as opposed to:
 * - simulateContract: always local, never broadcasts
 * - writeContract: returns tx ID only, no waiting or output extraction
 */
export async function executeContract(
  client: Client,
  params: ExecuteContractParameters,
): Promise<ExecuteContractReturnType> {
  const account = client.account
  if (!account || !('sign' in account)) {
    throw new AccountNotFoundError()
  }

  if (account.type === 'rpc') {
    // RPC account — wallet handles everything
    return client.request({
      method: 'executeTransaction',
      params: {
        programName: params.program,
        functionName: params.function,
        inputs: params.inputs,
        fee: params.fee,
        programSource: params.programSource,
        imports: params.imports,
      },
    }) as Promise<ExecuteContractReturnType>
  }

  if (account.type === 'local') {
    if (!client.proving?.execute) {
      // Fall back to simulate if execute not available
      if (client.proving?.simulate) {
        const result = await client.proving.simulate({
          programName: params.program,
          functionName: params.function,
          inputs: params.inputs,
          programSource: params.programSource,
          programImports: params.imports,
        })
        return { transactionId: '', outputs: result.outputs }
      }
      throw new ProvingNotConfiguredError()
    }

    return client.proving.execute({
      programName: params.program,
      functionName: params.function,
      inputs: params.inputs,
      fee: params.fee ?? 0n,
      privateFee: params.privateFee,
      programSource: params.programSource,
      programImports: params.imports,
    })
  }

  throw new AccountNotFoundError()
}
