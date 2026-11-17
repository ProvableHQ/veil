/**
 * Locates Shield Swap state files and saves updates atomically.
 *
 * Each network has a separate state file. Testnet also supports a state file
 * directly under the state root.
 */
import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Identifies the network whose session state is being read or written.
 */
type StateNetwork = 'testnet' | 'mainnet'

/**
 * Sets the root directory for session state.
 *
 * Uses `SHIELD_SWAP_STATE_DIR`, or `.shield-swap` in the working directory,
 * when this module is loaded.
 *
 * @example
 * const testnetDir = join(STATE_ROOT, 'testnet')
 */
export const STATE_ROOT = process.env.SHIELD_SWAP_STATE_DIR ?? join(process.cwd(), '.shield-swap')

/**
 * Identifies the fallback testnet state file at `<state root>/state.json`.
 *
 * Used only when `<state root>/testnet/state.json` does not exist.
 *
 * @example
 * const hasFallback = existsSync(LEGACY_STATE_PATH)
 */
export const LEGACY_STATE_PATH = join(STATE_ROOT, 'state.json')

/**
 * Builds the path to a network's state file without checking whether it exists.
 *
 * @param network Network whose state file is needed.
 * @returns `<state root>/<network>/state.json`.
 *
 * @example
 * const path = statePath('mainnet')
 */
export function statePath(network: StateNetwork): string {
  return join(STATE_ROOT, network, 'state.json')
}

/**
 * Finds an existing state file for the selected network.
 *
 * Checks `<state root>/<network>/state.json` first. For testnet, also checks
 * `<state root>/state.json`. Does not read file contents.
 *
 * @param network Network whose saved session is needed.
 * @returns The first existing path, or `undefined` if neither file exists.
 *
 * @example
 * const path = existingStatePath('testnet')
 * if (path === undefined) console.error('Run shield-swap setup first.')
 */
export function existingStatePath(network: StateNetwork): string | undefined {
  if (existsSync(statePath(network))) return statePath(network)
  return network === 'testnet' && existsSync(LEGACY_STATE_PATH) ? LEGACY_STATE_PATH : undefined
}

/**
 * Lists the paths where Shield Swap reads session state.
 *
 * Does not check whether the files exist.
 *
 * @returns The testnet, mainnet, and fallback testnet state paths.
 *
 * @example
 * const present = stateFiles().filter((path) => existsSync(path))
 */
export function stateFiles(): string[] {
  return [statePath('testnet'), statePath('mainnet'), LEGACY_STATE_PATH]
}

/**
 * Saves state as JSON without exposing a partially written target file.
 *
 * Creates a temporary file with mode 0600, then renames it over the target.
 * The parent directory MUST exist. On POSIX systems, only the owner can
 * read or write the file.
 *
 * @param target State file to create or replace.
 * @param state Data to serialize as JSON with two-space indentation.
 * @throws If serialization, the temporary write, or the rename fails.
 *   The existing target file remains unchanged.
 *
 * @example
 * writeStateFile(statePath('testnet'), { network: 'testnet' })
 */
export function writeStateFile(target: string, state: object): void {
  const tmp = `${target}.tmp`
  // Remove any previous temporary file so its permissions cannot be reused.
  rmSync(tmp, { force: true })
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 })
  renameSync(tmp, target)
}
