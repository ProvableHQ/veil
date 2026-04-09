import { AccountNotFoundError, ProvingNotConfiguredError } from '../../errors/errors.js'
import type { Client } from '../../clients/createClient.js'

export type SimulateContractParameters = {
  program: string
  programSource?: string
  function: string
  inputs: string[]
  imports?: Record<string, string>
}

export type SimulateContractReturnType = { outputs: string[] }

/**
 * Executes a program function locally and returns its outputs without broadcasting.
 *
 * This is the Aleo equivalent of a "dry run" or "call" — it runs the program
 * logic locally (via the proving config's `simulate` method) and returns the
 * output records/values as strings, without creating a transaction on-chain.
 *
 * Requires a local account with a proving config that implements `simulate`.
 */
export async function simulateContract(
  client: Client,
  params: SimulateContractParameters,
): Promise<SimulateContractReturnType> {
  const account = client.account
  if (!account || !('sign' in account)) {
    throw new AccountNotFoundError()
  }

  if (account.type === 'rpc') {
    // RPC account — delegate to wallet's simulate method if available
    return client.request({
      method: 'simulateTransaction',
      params: {
        programName: params.program,
        functionName: params.function,
        inputs: params.inputs,
        programSource: params.programSource,
        imports: params.imports,
      },
    }) as Promise<SimulateContractReturnType>
  }

  if (account.type === 'local') {
    if (!client.proving?.simulate) {
      throw new ProvingNotConfiguredError()
    }

    return client.proving.simulate({
      programName: params.program,
      functionName: params.function,
      inputs: params.inputs,
      programSource: params.programSource,
      programImports: params.imports,
    })
  }

  throw new AccountNotFoundError()
}
