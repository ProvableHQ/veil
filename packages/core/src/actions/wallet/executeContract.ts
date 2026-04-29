import { AccountNotFoundError, ProvingNotConfiguredError } from '../../errors/errors.js'
import type { Client } from '../../clients/createClient.js'
import type { RawExecuteResult } from '../../types/proving.js'

export type ExecuteContractParameters = {
  program: string
  function: string
  inputs: string[]
  /** Priority fee in microcredits (1 credit = 1_000_000 microcredits) */
  fee?: bigint
  privateFee?: boolean
  programSource?: string
  imports?: Record<string, string>
}

export type ExecuteContractReturnType = RawExecuteResult

/**
 * Executes a program function end-to-end: build, prove, broadcast, wait for
 * confirmation, and return raw output strings.
 *
 * Behavior by account type:
 * - Local account: proves (locally or via DPS), broadcasts, waits, returns outputs
 * - RPC account: delegates entire flow to the connected wallet
 *
 * Throws if execute is not configured on the proving config.
 * Use simulateContract for local-only execution without broadcasting.
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
    if (client.proving?.execute) {
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

    throw new ProvingNotConfiguredError()
  }

  throw new AccountNotFoundError()
}
