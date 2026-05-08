import { AccountNotFoundError, ProvingNotConfiguredError } from '../../errors/errors.js'
import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for `walletClient.deployContract`.
 *
 * Imports are not exposed here — the deployer auto-discovers them from the
 * program source.
 *
 * @property {string} program - Aleo program source (`program X.aleo; ...`).
 * @property {boolean} [privateFee] - If true, pay the deployment fee from a private record instead of the public credits balance. Defaults to `false`. The fee record is resolved via the wallet client's record provider; callers do not supply one.
 */
export type DeployContractParameters = {
  program: string
  privateFee?: boolean
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
      params: { program: params.program, privateFee: params.privateFee },
    }) as Promise<string>
  }

  if (account.type === 'local') {
    const { buildDeployment } = client.proving ?? {}
    if (!buildDeployment) throw new ProvingNotConfiguredError()

    const tx = await buildDeployment({ program: params.program, privateFee: params.privateFee })

    return client.request({
      method: 'sendTransaction',
      params: { transaction: JSON.stringify(tx) },
    }) as Promise<string>
  }

  throw new AccountNotFoundError()
}
