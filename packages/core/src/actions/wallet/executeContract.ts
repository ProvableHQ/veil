import { AccountNotFoundError, ProvingNotConfiguredError } from '../../errors/errors.js'
import type { Client } from '../../clients/createClient.js'
import type { RawExecuteResult } from '../../types/proving.js'
import { assertNoInputRequests } from '../../types/inputRequest.js'
import type { TransactionInput } from '../../types/inputRequest.js'
import { waitForConfirmation } from '../../utils/waitForConfirmation.js'
import { extractTransitions } from '../../utils/extractTransitions.js'

/**
 * Parameters for `walletClient.executeContract`.
 *
 * @property program Program id, e.g. `token.aleo`.
 * @property function Function/transition name to invoke.
 * @property inputs Function inputs: Aleo-encoded literal strings (e.g. `'100u64'`,
 *   `'aleo1...'`), or InputRequest objects the wallet fulfils. InputRequests require
 *   a wallet (RPC) account — the local-proving path rejects them.
 * @property fee Optional priority fee in microcredits (1 credit = 1_000_000
 *   microcredits). Defaults to 0. Local-proving path only; the wallet sets fees on
 *   the RPC path.
 * @property privateFee Pay the fee from a private record instead of the public
 *   credits balance. Defaults to `false`. The fee record is resolved via the wallet
 *   client's record provider; callers do not supply one.
 * @property programSource Optional program source to prove against instead of
 *   fetching it from the chain. Local-proving path only.
 * @property imports Program id → source for programs reached via dynamic dispatch
 *   that can't be discovered statically. Static imports are auto-discovered. The RPC
 *   path forwards only the ids; the wallet resolves the sources itself.
 */
export type ExecuteContractParameters = {
  program: string
  function: string
  inputs: TransactionInput[]
  fee?: bigint
  privateFee?: boolean
  programSource?: string
  imports?: Record<string, string>
}

/** Transaction id plus per-transition outputs of the confirmed execution. */
export type ExecuteContractReturnType = RawExecuteResult

/**
 * Executes a program function end-to-end: build, prove, broadcast, wait for
 * confirmation, and return per-transition outputs.
 *
 * Behavior by account type:
 * - Local account: proves (locally or via DPS), broadcasts, waits, decrypts owned record
 *   outputs with the self-custodied view key, returns outputs.
 * - RPC account: wallet submits and proves; the SDK then polls the chain for confirmation
 *   and walks the transitions itself. The SDK does NOT ask the wallet to decrypt — that's
 *   a permission boundary the dApp shouldn't cross. Record outputs surface as raw
 *   `record1...` ciphertexts; plaintext outputs surface verbatim.
 *
 * The RPC path requires a transport that can reach the chain (e.g. an HTTP transport,
 * or a fallback that includes one). A wallet-only transport will time out on the
 * confirmation poll.
 *
 * Use simulateContract for local-only execution without broadcasting.
 *
 * @param client Wallet client with an account attached.
 * @param params Program, function, inputs, and fee/source/import options.
 * @returns The transaction id with the outputs of every transition, once the transaction is accepted.
 * @throws AccountNotFoundError if the client has no signing account.
 * @throws ProvingNotConfiguredError if the account is local and the proving config lacks `execute`.
 * @throws If confirmation polling times out or the transaction is rejected.
 *
 * @example
 * const { transactionId, outputs } = await walletClient.executeContract({
 *   program: 'token.aleo',
 *   function: 'mint_private',
 *   inputs: ['aleo1...', '500u64'],
 * })
 */
export async function executeContract(
  client: Client,
  params: ExecuteContractParameters,
): Promise<ExecuteContractReturnType> {
  const account = client.account
  if (!account || !('sign' in account)) {
    throw new AccountNotFoundError()
  }

  if (account.type === 'rpc') {
    // 1. Submit via wallet — adapter transport returns the tx id. Param shape mirrors
    //    writeContract: the wallet handles fee + program-source resolution internally, so
    //    `fee` and `programSource` on this action don't translate to the wire call.
    const txId = await client.request({
      method: 'executeTransaction',
      params: {
        programName: params.program,
        functionName: params.function,
        inputs: params.inputs,
        privateFee: params.privateFee,
        imports: params.imports ? Object.keys(params.imports) : undefined,
      },
    }) as string

    // 2. Wait for chain confirmation via the same transport.
    const confirmedTx = await waitForConfirmation(client, txId)

    // 3. Walk transitions; no decryptor (see docstring).
    const { transitions, outputs } = extractTransitions(confirmedTx)

    return { transactionId: txId, transitions, outputs }
  }

  if (account.type === 'local') {
    // Local proving resolves no wallet-side inputs — only encoded strings.
    assertNoInputRequests(params.inputs)

    if (client.proving?.execute) {
      return client.proving.execute({
        programName: params.program,
        functionName: params.function,
        inputs: params.inputs,
        fee: params.fee ?? 0n,
        privateFee: params.privateFee,
        programSource: params.programSource,
        programImports: params.imports,
      })
    }

    throw new ProvingNotConfiguredError()
  }

  throw new AccountNotFoundError()
}
