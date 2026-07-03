import { AccountNotFoundError, ProvingNotConfiguredError, SimulateNotSupportedError } from '../../errors/errors.js'
import type { Client } from '../../clients/createClient.js'
import type { RawSimulateResult } from '../../types/proving.js'
import { assertNoInputRequests } from '../../types/inputRequest.js'
import type { TransactionInput } from '../../types/inputRequest.js'

/**
 * Parameters for `walletClient.simulateContract`.
 *
 * @property program Program id, e.g. `token.aleo`.
 * @property programSource Optional program source to run against instead of fetching it from the chain. Use it for programs not yet deployed.
 * @property function Function/transition name to invoke.
 * @property inputs Function inputs as Aleo-encoded literal strings (e.g. `'100u64'`, `'aleo1...'`). InputRequest objects are rejected — simulation has no wallet to fulfil them.
 * @property imports Program id → source for programs reached via dynamic dispatch that can't be discovered statically. Static imports are auto-discovered.
 */
export type SimulateContractParameters = {
  program: string
  programSource?: string
  function: string
  inputs: TransactionInput[]
  imports?: Record<string, string>
}

/** Per-transition outputs of the simulated execution; nothing is broadcast. */
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
 *
 * @param client Wallet client with a local account and proving config.
 * @param params Program, function, inputs, and optional source/import overrides.
 * @returns The outputs of every transition the call would produce.
 * @throws AccountNotFoundError if the client has no signing account.
 * @throws SimulateNotSupportedError if the account is an RPC (wallet) account.
 * @throws ProvingNotConfiguredError if the proving config lacks `simulate`.
 *
 * @example
 * const { outputs } = await walletClient.simulateContract({
 *   program: 'token.aleo',
 *   function: 'transfer_public',
 *   inputs: ['aleo1...', '100u64'],
 * })
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
