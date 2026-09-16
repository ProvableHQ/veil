/**
 * Moves the minimum public wrapped ETH amount from Aleo back to native ETH on Ethereum.
 *
 * A normal run only displays the Aleo balance and current Hyperlane delivery
 * payment. Execution delegates proof construction, signs the Aleo burn with the
 * key held by this process, and waits until the Ethereum recipient's balance
 * reflects Hyperlane's release.
 */

import { runAleoHyperlaneExample } from './aleo-hyperlane.js'

runAleoHyperlaneExample('ETH').catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
