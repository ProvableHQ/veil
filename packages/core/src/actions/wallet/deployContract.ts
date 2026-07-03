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

/** Transaction id (`at1...`) of the broadcast deployment. */
export type DeployContractReturnType = string

/**
 * Deploys an Aleo program to the network.
 *
 * Use it to publish new program source; once the deployment is
 * accepted, the program is callable via `writeContract`. For RPC accounts the
 * wallet builds, proves, and broadcasts the deployment, prompting the user.
 * For local accounts the proving config builds and proves it, then the
 * transport broadcasts. Deployment fees scale with program size and come out
 * of the account. Returns as soon as the transaction is submitted; it does
 * not wait for acceptance. Poll `transactionStatus` for the outcome.
 *
 * @param client Wallet client with an account attached.
 * @param params Program source and fee-privacy option.
 * @returns The transaction id to poll with `transactionStatus`.
 * @throws AccountNotFoundError if the client has no signing account.
 * @throws ProvingNotConfiguredError if the account is local and the client has no proving config.
 *
 * @example
 * const txId = await walletClient.deployContract({
 *   program: 'program hello.aleo; function main: ...',
 * })
 */
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
