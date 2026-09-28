/**
 * Moves the minimum native ETH amount from Ethereum into wrapped ETH on Aleo.
 *
 * A normal run only displays balances, current Ethereum gas, and the Hyperlane
 * delivery payment. Execution signs with the private key held by this process
 * and sends ETH directly to the reviewed Warp Route; no ERC-20 approval is
 * needed. Hyperlane then delivers and mints the Aleo representation.
 */

import { runEthereumHyperlaneExample } from './ethereum-hyperlane.js'

runEthereumHyperlaneExample('ETH').catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
