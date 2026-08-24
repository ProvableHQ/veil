import { runAleoHyperlaneExample } from './aleo-hyperlane.js'

/** Runs the mainnet Aleo SOL to Solana SOL Hyperlane example. */
runAleoHyperlaneExample('SOL').catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
