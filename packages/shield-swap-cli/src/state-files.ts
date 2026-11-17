/**
 * Paths and the atomic writer for the `shield-swap` state files.
 *
 * Internal to the package: `session.ts` re-exports what scripts need, and the
 * `account` command uses the rest to find a legacy key in the state directory.
 */
import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The networks a state directory is scoped by. */
type StateNetwork = 'testnet' | 'mainnet'

/** Root of the state directory: `SHIELD_SWAP_STATE_DIR`, or `./.shield-swap`. */
export const STATE_ROOT = process.env.SHIELD_SWAP_STATE_DIR ?? join(process.cwd(), '.shield-swap')

/** The pre-network layout, still read for testnet so existing state survives. */
export const LEGACY_STATE_PATH = join(STATE_ROOT, 'state.json')

/**
 * Names the state file of one network.
 *
 * @param network Network the state belongs to.
 * @returns `<state root>/<network>/state.json`, whether or not it exists.
 */
export function statePath(network: StateNetwork): string {
  return join(STATE_ROOT, network, 'state.json')
}

/**
 * Finds the state file a network's session is read from.
 *
 * Falls back to the pre-network layout for testnet only, so an existing
 * `.shield-swap/state.json` keeps working. Checks the disk and reads nothing.
 *
 * @param network Network the state belongs to.
 * @returns The path of the file that exists, or `undefined` when the network
 *   has no state yet.
 */
export function existingStatePath(network: StateNetwork): string | undefined {
  if (existsSync(statePath(network))) return statePath(network)
  return network === 'testnet' && existsSync(LEGACY_STATE_PATH) ? LEGACY_STATE_PATH : undefined
}

/**
 * Lists every state file the state directory can hold.
 *
 * @returns The testnet and mainnet state files and the pre-network one,
 *   whether or not they exist.
 */
export function stateFiles(): string[] {
  return [statePath('testnet'), statePath('mainnet'), LEGACY_STATE_PATH]
}

/**
 * Writes a state file atomically, readable by its owner only.
 *
 * The content goes to a temporary file created at mode 0600 and is then
 * renamed over the target, so a crash mid-write cannot truncate the state and
 * the content is never readable by others, even briefly. The directory MUST
 * exist.
 *
 * @param target Path of the state file.
 * @param state Content, written as JSON with two-space indentation.
 */
export function writeStateFile(target: string, state: object): void {
  const tmp = `${target}.tmp`
  // A leftover temporary file keeps its own mode, so it is removed and the
  // new one is created at 0600 from the start.
  rmSync(tmp, { force: true })
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 })
  renameSync(tmp, target)
}
