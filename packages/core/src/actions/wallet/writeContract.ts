import { AccountNotFoundError, FeeRequiredError, ProvingNotConfiguredError } from '../../errors/errors.js'
import type { Client } from '../../clients/createClient.js'

export type WriteContractParameters = {
  program: string
  function: string
  inputs: string[]
  fee?: bigint
  privateFee?: boolean
}

export type WriteContractReturnType = string

export async function writeContract(
  client: Client,
  params: WriteContractParameters,
): Promise<WriteContractReturnType> {
  const account = client.account
  if (!account || !('sign' in account)) {
    throw new AccountNotFoundError()
  }

  if (account.type === 'rpc') {
    // RPC account — wallet handles proving, signing, and broadcasting
    return client.request({
      method: 'executeTransaction',
      params: {
        programName: params.program,
        functionName: params.function,
        inputs: params.inputs,
        fee: params.fee,
        privateFee: params.privateFee,
      },
    }) as Promise<string>
  }

  if (account.type === 'local') {
    const buildTransaction = client.devnode?.buildTransaction ?? client.proving?.buildTransaction
    if (!buildTransaction) {
      throw new ProvingNotConfiguredError()
    }
    if (params.fee === undefined) {
      throw new FeeRequiredError()
    }

    const tx = await buildTransaction({
      programName: params.program,
      functionName: params.function,
      inputs: params.inputs,
      fee: params.fee,
      privateFee: params.privateFee,
    })

    return client.request({
      method: 'sendTransaction',
      params: { transaction: JSON.stringify(tx) },
    }) as Promise<string>
  }

  throw new AccountNotFoundError()
}

/** Alias for writeContract — consistent with Aleo wallet adapter terminology */
export const executeTransaction = writeContract
