/**
 * Moves the minimum public wrapped SOL amount from Aleo back to native SOL on Solana.
 *
 * A normal run only displays the Aleo balance and current Hyperlane delivery
 * payment. Execution delegates proof construction, signs the Aleo burn with the
 * key held by this process, and waits until the Solana recipient's balance
 * reflects Hyperlane's release.
 */

import { runAleoHyperlaneExample } from './aleo-hyperlane.js'

runAleoHyperlaneExample('SOL').catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
