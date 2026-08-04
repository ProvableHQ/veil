import type { Client } from '../clients/createClient.js'
import type { ConfirmedTransaction } from '../types/block.js'
import { FinalizeRevertError, TransactionTimeoutError } from '../errors/errors.js'

/**
 * Ceiling on the confirmation wait.
 *
 * Healthy confirmations on the public networks land inside a handful of blocks;
 * a transaction still absent after a minute is far more often one the node
 * never included than one about to arrive, and waiting longer only delays the
 * report. Callers on a congested network can raise it per call.
 */
const DEFAULT_TIMEOUT_MS = 60_000
const POLL_INTERVAL_MS = 5_000

/**
 * Poll the chain until `txId` is confirmed, then return the inner transaction object.
 *
 * Goes through `client.request({ method: 'getConfirmedTransaction', ... })`, so the
 * caller's transport must be able to reach the chain (HTTP transport or a fallback
 * that includes one). Wallet-only transports will fail every poll and time out.
 *
 * Throws `FinalizeRevertError` if the confirmation envelope reports `status: 'rejected'`.
 * Throws `TransactionTimeoutError` if no confirmation arrives within `timeoutMs`.
 */
export async function waitForConfirmation(
  client: Client,
  txId: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const startTime = Date.now()
  let lastError: unknown
  // Counted so the timeout can report what the node actually said. A node that
  // answered cleanly every time and simply did not have the transaction is a
  // different situation from one that could not be reached, and the two call
  // for opposite next steps.
  let polls = 0
  let absentPolls = 0
  while (Date.now() - startTime < timeoutMs) {
    polls++
    try {
      const confirmed = await client.request({
        method: 'getConfirmedTransaction',
        params: { id: txId },
      }) as ConfirmedTransaction | null
      if (confirmed) {
        if (confirmed.status === 'rejected') {
          throw new FinalizeRevertError(txId)
        }
        return confirmed.transaction
      }
      absentPolls++
    } catch (e) {
      if (e instanceof FinalizeRevertError) throw e
      lastError = e
      // A 404 is the node reporting the transaction absent, which is how a
      // pending transaction reads too — not a failure to reach the node.
      if ((e as { status?: number } | null)?.status === 404) absentPolls++
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new TransactionTimeoutError({
    transactionId: txId,
    timeoutMs,
    polls,
    absentPolls,
    cause: lastError as Error | undefined,
  })
}
