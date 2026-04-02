import { AccountNotFoundError } from '../../errors/errors.js'
import type { SignerAccount } from '../../types/account.js'
import type { Client } from '../../clients/createClient.js'

export type WriteContractParameters = {
  program: string
  function: string
  inputs: string[]
  fee: bigint
  privateFee?: boolean
}

export type WriteContractReturnType = string

export async function writeContract(
  client: Client,
  params: WriteContractParameters,
): Promise<WriteContractReturnType> {
  if (!client.account || !('sign' in client.account)) {
    throw new AccountNotFoundError()
  }

  // If client has proving config with a custom buildTransaction, use it
  if (client.proving?.buildTransaction) {
    const tx = await client.proving.buildTransaction({
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

  // For RPC accounts or when proving mode handles it, delegate to the transport
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

/** Alias for writeContract — consistent with Aleo wallet adapter terminology */
export const executeTransaction = writeContract
