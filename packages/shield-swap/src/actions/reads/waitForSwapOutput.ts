import type { Client } from '@provablehq/veil-core'
import type { SwapHandle } from '../swap/swap.js'
import { getSwapOutput, type GetSwapOutputReturnType } from './getSwapOutput.js'

/**
 * Parameters for {@link waitForSwapOutput}.
 *
 * @property handle Single- or multi-hop swap handle with its swapId resolved.
 * @property program AMM program override. Defaults to the handle's program.
 * @property timeout Polling timeout in milliseconds. Defaults to 120,000.
 *   Must be finite and positive. In-flight reads use the transport's timeout.
 * @property pollingInterval Delay between absent-output reads in milliseconds.
 *   Defaults to 3,000; must be finite and positive.
 */
export type WaitForSwapOutputParameters = {
  handle: Pick<SwapHandle, 'swapId' | 'program'>
  program?: string
  timeout?: number
  pollingInterval?: number
}

/** Returns the decoded on-chain output once it becomes readable. */
export type WaitForSwapOutputReturnType = NonNullable<GetSwapOutputReturnType>

/**
 * Waits for a finalized swap output to become readable on chain.
 *
 * Polls only the output mapping; never signs or submits a transaction. Mapping
 * visibility can lag transaction confirmation. Confirm the request transaction
 * first when rejection must be detected immediately. An absent mapping can
 * also mean the output was already claimed; a timeout does not prove failure
 * and must not trigger a new swap. Transport and decoding errors propagate.
 *
 * @param client A client with a chain-readable transport; no account required.
 * @param params The handle to observe and optional polling settings.
 * @returns The decoded output, including atomic output and refund amounts.
 * @throws When the swap id or timing options are invalid, polling times out,
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
  const { handle, timeout = 120_000, pollingInterval = 3_000 } = params
  if (!handle.swapId) throw new Error('handle.swapId must be resolved from the confirmed swap before waiting for its output')
  for (const [name, value] of Object.entries({ timeout, pollingInterval })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a finite positive number of milliseconds`)
  }
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const output = await getSwapOutput(client, { swapId: handle.swapId, program: params.program ?? handle.program })
    if (output) return output
    const remaining = deadline - Date.now()
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(pollingInterval, remaining)))
  }
  throw new Error(`Timed out waiting for swap output ${handle.swapId}; recover this handle before starting another trade (the output may also be already claimed)`)
}
