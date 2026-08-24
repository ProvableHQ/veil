/**
 * Mainnet native ETH to Aleo ETH Hyperlane demo.
 *
 * Run without EXECUTE_HYPERLANE_ETH for a read-only quote. Native ETH is sent
 * directly to the reviewed Warp Route and does not require ERC-20 approval.
 */

import { runEthereumHyperlaneExample } from './ethereum-hyperlane.js'

runEthereumHyperlaneExample('ETH').catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
