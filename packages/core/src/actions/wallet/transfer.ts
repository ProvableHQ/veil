import type { Client } from '../../clients/createClient.js'
import { writeContract } from './writeContract.js'

export type TransferParameters = {
  to: string
  amount: bigint
  privateFee?: boolean
}

export type TransferReturnType = string

export async function transfer(
  client: Client,
  params: TransferParameters,
): Promise<TransferReturnType> {
  return writeContract(client, {
    program: 'credits.aleo',
    function: params.privateFee ? 'transfer_private' : 'transfer_public',
    inputs: [params.to, `${params.amount}u64`],
    fee: 0n,
    privateFee: params.privateFee,
  })
}
