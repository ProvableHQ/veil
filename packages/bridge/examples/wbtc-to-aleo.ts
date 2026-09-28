/**
 * Moves the minimum WBTC amount from Ethereum into wrapped WBTC on Aleo.
 *
 * A normal run only displays balances, allowance, current Ethereum gas, and the
 * Hyperlane delivery payment. Execution signs with the private key held by this
 * process, grants the reviewed Warp Route an exact allowance when necessary,
 * then dispatches WBTC for delivery and minting on Aleo.
 */

import { runEthereumHyperlaneExample } from './ethereum-hyperlane.js'

runEthereumHyperlaneExample('WBTC').catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
