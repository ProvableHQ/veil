import { runAleoHyperlaneExample } from './aleo-hyperlane.js'

/** Runs the mainnet Aleo ETH to Ethereum ETH Hyperlane example. */
runAleoHyperlaneExample('ETH').catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
