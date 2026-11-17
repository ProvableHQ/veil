/**
 * Names the `shield-swap` state files and writes them atomically.
 *
 * Internal to the package: `session.ts` re-exports what scripts need, and the
 * `account` command uses the rest to find a key held in the state directory.
 */
import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Networks that each have a state directory of their own. */
type StateNetwork = 'testnet' | 'mainnet'

/** Root of the state directory: `SHIELD_SWAP_STATE_DIR`, or `./.shield-swap`. */
export const STATE_ROOT = process.env.SHIELD_SWAP_STATE_DIR ?? join(process.cwd(), '.shield-swap')

/** State file directly under the state root. Read for testnet when `testnet/state.json` does not exist. */
export const LEGACY_STATE_PATH = join(STATE_ROOT, 'state.json')

/**
 * Names the state file of one network.
 *
 * Builds the path without checking the disk.
 *
 * @param network Network the state belongs to.
 * @returns `<state root>/<network>/state.json`, whether or not it exists.
 *
 * @example
 * const path = statePath('mainnet') // <state root>/mainnet/state.json
 */
export function statePath(network: StateNetwork): string {
  return join(STATE_ROOT, network, 'state.json')
}

/**
 * Finds the state file a network's session is read from.
 *
 * For testnet, falls back to `state.json` directly under the state root when
 * `testnet/state.json` does not exist. Checks which files exist and reads
 * neither.
 *
 * @param network Network the state belongs to.
 * @returns The path of the file that exists, or `undefined` when the network
 *   has no state yet.
 *
 * @example
 * const path = existingStatePath('testnet')
 * if (path === undefined) console.error('run shield-swap setup first')
 */
export function existingStatePath(network: StateNetwork): string | undefined {
  if (existsSync(statePath(network))) return statePath(network)
  return network === 'testnet' && existsSync(LEGACY_STATE_PATH) ? LEGACY_STATE_PATH : undefined
}

/**
 * Lists every state file the state directory can hold.
 *
 * Builds the paths without checking the disk.
 *
 * @returns The testnet and mainnet state files and the one directly under the
 *   state root, whether or not they exist.
 *
 * @example
 * const present = stateFiles().filter((path) => existsSync(path))
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
 * @throws When the directory does not exist or the file cannot be written. The
 *   target is then left as it was.
 *
 * @example
 * writeStateFile(statePath('testnet'), { network: 'testnet', address })
 */
export function writeStateFile(target: string, state: object): void {
  const tmp = `${target}.tmp`
  // A leftover temporary file keeps its own mode, so it is removed and the
  // new one is created at 0600 from the start.
  rmSync(tmp, { force: true })
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 })
  renameSync(tmp, target)
}
