import { AccountNotFoundError, ProvingNotConfiguredError } from '../../errors/errors.js'
import type { Client } from '../../clients/createClient.js'
import { assertNoInputRequests } from '../../types/inputRequest.js'
import type { TransactionInput } from '../../types/inputRequest.js'

/**
 * Parameters for `walletClient.writeContract` (alias `executeTransaction`).
 *
 * @property program Program id, e.g. `token.aleo`.
 * @property function Function/transition name to invoke.
 * @property inputs Function inputs: Aleo-encoded literal strings (e.g. `'100u64'`,
 *   `'aleo1...'`), or InputRequest objects the wallet fulfils (address/record/derived).
 *   InputRequests require a wallet (RPC) account — the local-proving path rejects them.
 * @property privateFee Pay the fee from a private record instead of the public credits
 *   balance. Defaults to `false`. The fee record is resolved via the wallet client's
 *   record provider; callers do not supply one.
 * @property imports Names of programs reached via dynamic dispatch that the prover or
 *   wallet can't discover statically. Static imports in the program's `import` block are
 *   auto-discovered.
 */
export type WriteContractParameters = {
  program: string
  function: string
  inputs: TransactionInput[]
  privateFee?: boolean
  imports?: string[]
}

/** Transaction id (`at1...`) of the broadcast execution. */
export type WriteContractReturnType = string

/**
 * Executes a program function on-chain and returns the transaction id.
 *
 * The workhorse write action — use it whenever the transaction id is
 * enough and the function's outputs are not needed (use `executeContract` for
 * outputs, `simulateContract` for a dry run). For RPC accounts the wallet
 * proves, signs, and broadcasts in one adapter call, prompting the user. For
 * local accounts the proving config builds and proves the transaction —
 * in-process or via a delegated prover, per `proving.mode` — and the transport
 * broadcasts it. Either way the fee comes out of the account (unless a
 * delegated prover with `useFeeMaster` covers it). Returns as soon as the
 * transaction is submitted; it does not wait for acceptance. Poll
 * `transactionStatus` for the outcome.
 *
 * Exported as `executeTransaction` as well — the wallet-adapter name for the
 * same action.
 *
 * @param client Wallet client with an account attached.
 * @param params Program, function, inputs, and fee/import options.
 * @returns The transaction id to poll with `transactionStatus`.
 * @throws AccountNotFoundError if the client has no signing account.
 * @throws ProvingNotConfiguredError if the account is local and the client has no proving config.
 * @throws If `inputs` contains InputRequest objects on the local-proving path.
 *
 * @example
 * const txId = await walletClient.writeContract({
 *   program: 'token.aleo',
 *   function: 'transfer_public',
 *   inputs: ['aleo1...', '100u64'],
 * })
 */
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
        privateFee: params.privateFee,
        imports: params.imports,
      },
    }) as Promise<string>
  }

  if (account.type === 'local') {
    // Local proving resolves no wallet-side inputs — only encoded strings.
    assertNoInputRequests(params.inputs)

    const buildTransaction = client.proving?.buildTransaction
    if (!buildTransaction) {
      throw new ProvingNotConfiguredError()
    }

    const tx = await buildTransaction({
      programName: params.program,
      functionName: params.function,
      inputs: params.inputs,
      privateFee: params.privateFee,
      imports: params.imports,
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
