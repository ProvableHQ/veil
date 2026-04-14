import { AccountNotFoundError, ProvingNotConfiguredError } from '../../errors/errors.js'
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
    // Local account — must prove locally, then broadcast the raw transaction
    if (!client.proving?.buildTransaction) {
      throw new ProvingNotConfiguredError()
    }

    const tx = await client.proving.buildTransaction({
      programName: params.program,
      functionName: params.function,
      inputs: params.inputs,
      fee: params.fee ?? 0n,
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
