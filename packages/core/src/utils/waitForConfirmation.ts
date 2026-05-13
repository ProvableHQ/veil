import type { Client } from '../clients/createClient.js'
import type { ConfirmedTransaction } from '../types/block.js'
import { FinalizeRevertError, TransactionTimeoutError } from '../errors/errors.js'

const DEFAULT_TIMEOUT_MS = 300_000
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
  while (Date.now() - startTime < timeoutMs) {
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
    } catch (e) {
      if (e instanceof FinalizeRevertError) throw e
      lastError = e
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new TransactionTimeoutError({ transactionId: txId, timeoutMs, cause: lastError as Error | undefined })
}
