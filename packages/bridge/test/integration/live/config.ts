/** Returns a required live-test environment value without logging it. */
export function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing ${name}; live bridge test was explicitly enabled but is not configured`)
  return value
}

/** Reports whether deployed bridge tests have been explicitly enabled. */
export function liveFundsEnabled(): boolean {
  return process.env.BRIDGE_LIVE_FUNDS === '1' && Boolean(process.env.BRIDGE_LIVE_STATE_DIR)
}

/** Reports whether one named mainnet case has both acknowledgements. */
export function mainnetCaseEnabled(name: string): boolean {
  if (!liveFundsEnabled()) return false
  if (process.env.BRIDGE_LIVE_MAINNET_ACK !== 'I_ACKNOWLEDGE_BRIDGE_MAINNET_FUNDS') return false
  const cases = new Set((process.env.BRIDGE_LIVE_MAINNET_CASES ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean))
  return cases.has(name)
}

/** Reports whether mainnet wallet submissions have received the final acknowledgement. */
export function mainnetExecutionEnabled(): boolean {
  return process.env.BRIDGE_LIVE_MAINNET_EXECUTE === 'I_ACKNOWLEDGE_THIS_SUBMITS_MAINNET_TRANSACTIONS'
}

/** Formats the smallest positive display amount supported by an asset. */
export function oneAtomicUnit(decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error(`Invalid asset decimals: ${decimals}`)
  return decimals === 0 ? '1' : `0.${'0'.repeat(decimals - 1)}1`
}

/** Resolves one scenario-specific state file outside the repository. */
export function liveStatePath(environment: 'mainnet' | 'testnet', name: string): string {
  return join(required('BRIDGE_LIVE_STATE_DIR'), environment, `${name}.json`)
}
import { join } from 'node:path'
