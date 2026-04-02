import { AccountNotFoundError } from '../../errors/errors.js'
import type { Client } from '../../clients/createClient.js'

export type DeployContractParameters = {
  program: string
  fee: bigint
}

export type DeployContractReturnType = string

export async function deployContract(
  client: Client,
  params: DeployContractParameters,
): Promise<DeployContractReturnType> {
  if (!client.account || !('sign' in client.account)) {
    throw new AccountNotFoundError()
  }

  return client.request({
    method: 'deployProgram',
    params: { program: params.program, fee: params.fee },
  }) as Promise<string>
}
