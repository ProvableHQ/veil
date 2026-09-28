import { getConfirmedTransaction, FinalizeRevertError, type Client } from '@provablehq/veil-core'
import type { SwapHandle } from '../swap/swap.js'
import { getSwapOutput, type GetSwapOutputReturnType } from './getSwapOutput.js'

/**
 * Parameters for {@link waitForSwapOutput}.
 *
 * @property handle Single- or multi-hop swap handle with a transactionId and
 *   its swapId resolved.
 * @property program AMM program override. Defaults to the handle's program.
 * @property timeout Shared confirmation and output polling timeout in milliseconds.
 *   Defaults to 15,000.
 *   Must be finite and positive. In-flight reads use the transport's timeout.
 * @property pollingInterval Delay between pending confirmation or output reads in milliseconds.
 *   Defaults to 3,000; must be finite and positive.
 */
export type WaitForSwapOutputParameters = {
  handle: Pick<SwapHandle, 'swapId' | 'program' | 'transactionId'>
  program?: string
  timeout?: number
  pollingInterval?: number
}

/** Returns the decoded on-chain output once it becomes readable. */
export type WaitForSwapOutputReturnType = NonNullable<GetSwapOutputReturnType>

/**
 * Waits for a finalized swap output to become readable on chain.
 *
 * Confirms the request transaction, then polls the output mapping using the
 * same deadline. Rejected transactions fail immediately. Never signs or submits
 * a transaction. Mapping visibility can lag confirmation. An absent mapping can
 * also mean the output was already claimed; a timeout does not prove failure
 * and must not trigger a new swap. Transport and decoding errors propagate.
 *
 * @param client A client with a chain-readable transport; no account required.
 * @param params The handle to observe and optional polling settings.
 * @returns The decoded output, including atomic output and refund amounts.
 * @throws {FinalizeRevertError} When the request transaction was rejected.
 *   Also throws when handle fields or timing options are invalid, polling times out,
 *   or a chain read fails. Recover the existing handle after a timeout.
 *
 * @example
 * await client.waitForSwapOutput({ handle })
 * const claim = await client.claimSwapOutput({ handle })
 */
export async function waitForSwapOutput(
  client: Client,
  params: WaitForSwapOutputParameters,
): Promise<WaitForSwapOutputReturnType> {
  const { handle, timeout = 15_000, pollingInterval = 3_000 } = params
  if (!handle.transactionId) throw new Error('handle.transactionId is required to confirm the swap before waiting for its output')
  if (!handle.swapId) throw new Error('handle.swapId must be resolved from the confirmed swap before waiting for its output')
  for (const [name, value] of Object.entries({ timeout, pollingInterval })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a finite positive number of milliseconds`)
  }
  const deadline = Date.now() + timeout
  let confirmed = false
  while (Date.now() < deadline) {
    if (!confirmed) {
      const transaction = await getConfirmedTransaction(client, { id: handle.transactionId }).catch((error: unknown) => {
        // An unconfirmed transaction can be reported as either null or HTTP 404.
        if ((error as { status?: number } | null)?.status === 404) return null
        throw error
      })
      if (transaction?.status === 'rejected') {
        const feeTransactionId = typeof transaction.transaction.id === 'string' ? transaction.transaction.id : undefined
        throw new FinalizeRevertError(handle.transactionId, { feeTransactionId })
      }
      confirmed = transaction?.status === 'accepted'
    }
    if (confirmed && Date.now() < deadline) {
      const output = await getSwapOutput(client, { swapId: handle.swapId, program: params.program ?? handle.program })
      if (output) return output
    }
    const remaining = deadline - Date.now()
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(pollingInterval, remaining)))
  }
  throw new Error(`Timed out waiting for swap output ${handle.swapId}; recover this handle before starting another trade (the output may also be already claimed)`)
}
