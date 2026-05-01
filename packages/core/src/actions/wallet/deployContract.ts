import { AccountNotFoundError, ProvingNotConfiguredError } from '../../errors/errors.js'
import type { Client } from '../../clients/createClient.js'

export type DeployContractParameters = {
  program: string
  fee?: bigint
}

export type DeployContractReturnType = string

export async function deployContract(
  client: Client,
  params: DeployContractParameters,
): Promise<DeployContractReturnType> {
  const account = client.account
  if (!account || !('sign' in account)) {
    throw new AccountNotFoundError()
  }

  if (account.type === 'rpc') {
    // RPC account — wallet handles deployment
    return client.request({
      method: 'deployProgram',
      params: { program: params.program, fee: params.fee },
    }) as Promise<string>
  }

  if (account.type === 'local') {
    // Local account — must build deployment transaction locally
    if (!client.proving?.buildDeployment) {
      throw new ProvingNotConfiguredError()
    }

    const tx = await client.proving.buildDeployment({
      program: params.program,
      fee: params.fee ?? 0n,
    })

    return client.request({
      method: 'sendTransaction',
      params: { transaction: JSON.stringify(tx) },
    }) as Promise<string>
  }

  throw new AccountNotFoundError()
}
