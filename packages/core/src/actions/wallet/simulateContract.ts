import { AccountNotFoundError, ProvingNotConfiguredError, SimulateNotSupportedError } from '../../errors/errors.js'
import type { Client } from '../../clients/createClient.js'
import type { RawSimulateResult } from '../../types/proving.js'
import { assertNoInputRequests } from '../../types/inputRequest.js'
import type { TransactionInput } from '../../types/inputRequest.js'

export type SimulateContractParameters = {
  program: string
  programSource?: string
  function: string
  inputs: TransactionInput[]
  imports?: Record<string, string>
}

export type SimulateContractReturnType = RawSimulateResult

/**
 * Executes a program function locally and returns its outputs without broadcasting.
 *
 * This is the Aleo equivalent of a "dry run" — it runs the program
 * logic locally (via the proving config's `simulate` method) and returns the
 * output records/values as strings, without creating a transaction on-chain.
 *
 * Only available for local accounts with a proving config that implements `simulate`.
 * Not available for RPC (wallet) accounts.
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
    throw new SimulateNotSupportedError()
  }

  if (account.type === 'local') {
    // Simulation runs locally and resolves no wallet-side inputs.
    assertNoInputRequests(params.inputs)

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
