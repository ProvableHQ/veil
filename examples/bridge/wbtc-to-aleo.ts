/**
 * Mainnet WBTC to Aleo WBTC Hyperlane demo.
 *
 * Run without EXECUTE_HYPERLANE_WBTC for a read-only quote. Live execution
 * submits an exact WBTC approval only when the Warp Route allowance is low.
 */

import { runEthereumHyperlaneExample } from './ethereum-hyperlane.js'

runEthereumHyperlaneExample('WBTC').catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
