import { runAleoHyperlaneExample } from './aleo-hyperlane.js'

/** Runs the mainnet Aleo WBTC to Ethereum WBTC Hyperlane example. */
runAleoHyperlaneExample('WBTC').catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
