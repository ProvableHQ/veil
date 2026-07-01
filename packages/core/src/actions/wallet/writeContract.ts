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
