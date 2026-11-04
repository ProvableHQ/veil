/**
 * Sends USDG between Ethereum and Aleo through Hyperlane.
 *
 * Run with `to-aleo` or `from-aleo` to select one direction. A normal run quotes
 * 1 USDG using public addresses and requires no private key. Execution requires
 * the source key, a durable state path, and the explicit mainnet acknowledgement.
 * See the USDG section in README.md for configuration and recovery commands.
 */

import { runArc22Example } from './arc22-hyperlane.js'

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function main(): Promise<void> {
  // Require an explicit direction so a withdrawal cannot become a deposit.
  const direction = process.argv[2]
  if (direction !== 'to-aleo' && direction !== 'from-aleo') {
    throw new Error('Usage: npx tsx usdg-ethereum.ts <to-aleo|from-aleo>')
  }

  // Ethereum deposits lock ERC-20 USDG and mint public USDG on Aleo. The SDK
  // approves the required token allowance when needed. Withdrawals burn public
  // Aleo USDG and release Ethereum USDG; unshield private records separately.
  // Amounts are decimal USDG strings, with at most six fractional digits.
  await runArc22Example({
    routeId: direction === 'to-aleo'
      ? 'hyperlane:ethereum/usdg->aleo/usdg'
      : 'hyperlane:aleo/usdg->ethereum/usdg',
    amount: process.env.USDG_AMOUNT?.trim() || '1',
    sender: requiredEnvironmentVariable('USDG_SENDER'),
    recipient: requiredEnvironmentVariable('USDG_RECIPIENT'),
    statePath: process.env.USDG_STATE_PATH?.trim(),
    execute: process.env.EXECUTE_BRIDGE === 'I_UNDERSTAND_THIS_MOVES_REAL_FUNDS',
  })
  // The shared helper calls bridge.quote, persists bridge.execute checkpoints,
  // and uses bridge.recover / bridge.wait to verify delivery after a restart.
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
