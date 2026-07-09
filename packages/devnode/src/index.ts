import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import type { Client } from '@veil/core'

/** The well-known seeded private key used by Aleo Devnode */
export const DEVNODE_PRIVATE_KEY = 'APrivateKey1zkp8CZNn3yeCseEtxuVPbDCwSyhGW6yZKUYKfgXmcpoGPWH'

/** Default local devnode socket address */
export const DEVNODE_ADDR = '127.0.0.1:3030'

const HEALTH_CHECK_PATH = '/testnet/block/height/latest'
const HEALTH_CHECK_INTERVAL_MS = 250
const HEALTH_CHECK_REQUEST_TIMEOUT_MS = 1_000

// =============================================================================
// Types
// =============================================================================

/**
 * Options for {@link startDevnode}.
 *
 * Most fields map to flags of the `aleo-devnode start` subcommand.
 */
export type DevnodeStartOptions = {
  /** Private key for block creation. Defaults to `DEVNODE_PRIVATE_KEY`. */
  privateKey?: string
  /** `-a, --socket-addr`. REST API bind address. Defaults to `DEVNODE_ADDR`. */
  socketAddr?: string
  /** `-v, --verbosity` (0–2). Defaults to 2. */
  verbosity?: 0 | 1 | 2
  /** `-g, --genesis-path`. Path to a custom genesis block file. */
  genesisPath?: string
  /**
   * `-s, --storage [DIR]`. Directory for persistent ledger storage.
   * - Omit for in-memory (ephemeral).
   * - Pass an empty string to use the default "./devnode" directory.
   * - Pass a path string for a custom directory.
   */
  storagePath?: string
  /** `-c, --clear-storage`. Clear the storage directory before starting. Requires `storagePath`. */
  clearStorage?: boolean
  /** `-m, --manual-block-creation`. Disable automatic block creation after broadcast. */
  manualBlockCreation?: boolean
  /** Milliseconds to wait for the REST API to become ready. Defaults to 30000. */
  readyTimeout?: number
  /** Path to the aleo-devnode binary. Defaults to `'aleo-devnode'` (resolved on PATH). */
  devnodePath?: string
  /** Write devnode stdout/stderr to devnode-<port>.log in the current directory. Defaults to false. */
  verbose?: boolean
}

/**
 * Options for {@link advanceDevnode}.
 *
 * Fields map to the `aleo-devnode advance` subcommand.
 */
export type DevnodeAdvanceOptions = {
  /** Number of blocks to advance. Defaults to 1. */
  numBlocks?: number
  /** `--socket-addr`. Target devnode socket. Defaults to `DEVNODE_ADDR`. */
  socketAddr?: string
  /** Path to the aleo-devnode binary. Defaults to `'aleo-devnode'` (resolved on PATH). */
  devnodePath?: string
}

/**
 * Options for {@link restoreDevnode}.
 *
 * Fields map to flags of the `aleo-devnode restore` subcommand. Restoring
 * requires persistent storage, so the snapshot must have been taken from a
 * devnode started with `storagePath`.
 */
export type DevnodeRestoreOptions = {
  /** `--snapshot`. Name of the snapshot to restore. Required. */
  snapshot: string
  /** `--storage`. Ledger storage directory to restore into. Defaults to `'devnode'`. */
  storage?: string
  /** `--restart`. Restart the devnode after restoring. */
  restart?: boolean
  /** `--private-key`. Required when `restart` is true (or set via `$PRIVATE_KEY`). */
  privateKey?: string
  /** `-a, --socket-addr`. Forwarded to `start` when `restart` is true. */
  socketAddr?: string
  /** `-v, --verbosity`. Forwarded to `start` when `restart` is true. */
  verbosity?: 0 | 1 | 2
  /** `-m, --manual-block-creation`. Forwarded to `start` when `restart` is true. */
  manualBlockCreation?: boolean
  /** Path to the aleo-devnode binary. Defaults to `'aleo-devnode'` (resolved on PATH). */
  devnodePath?: string
}

/**
 * Handle to a running devnode process returned by {@link startDevnode}.
 *
 * Hold on to it for the lifetime of the node and call `stop()` when done —
 * the child process is not stopped automatically when the parent exits.
 */
export type DevnodeInstance = {
  /** Socket address the devnode is listening on. */
  socketAddr: string
  /** Terminates the devnode process gracefully (SIGTERM). */
  stop: () => Promise<void>
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Starts a local Aleo devnode and waits until its REST API answers.
 *
 * Spawns the `aleo-devnode` binary as a child process, so it MUST be
 * installed and on PATH (or located via `devnodePath`). If a devnode is
 * already listening on the target socket, it is asked to shut down first so
 * the new instance can bind. Resolves once the node serves block height, or
 * rejects after `readyTimeout`.
 *
 * By default the node binds `127.0.0.1:3030`, keeps its ledger in memory
 * (lost on stop), creates blocks automatically, and produces blocks with the
 * well-known seeded key {@link DEVNODE_PRIVATE_KEY}.
 *
 * @param options Overrides for the defaults above; omit for an ephemeral
 *   node on port 3030.
 * @returns A {@link DevnodeInstance} — keep it and call `stop()` to terminate
 *   the process.
 * @throws If the binary is missing, the process exits during startup, or the
 *   REST API is not ready within `readyTimeout` (default 30000 ms).
 *
 * @example
 * import { startDevnode } from '@veil/devnode'
 *
 * const devnode = await startDevnode()
 * // ...run tests against http://127.0.0.1:3030...
 * await devnode.stop()
 */
export async function startDevnode(options?: DevnodeStartOptions): Promise<DevnodeInstance> {
  const privateKey = options?.privateKey ?? DEVNODE_PRIVATE_KEY
  const socketAddr = options?.socketAddr ?? DEVNODE_ADDR
  const verbosity = options?.verbosity ?? 2
  const readyTimeout = options?.readyTimeout ?? 30_000
  const devnodePath = options?.devnodePath ?? 'aleo-devnode'
  const verbose = options?.verbose ?? false

  await tryShutdownExisting(socketAddr)

  const args = [
    'start',
    '--private-key', privateKey,
    '--socket-addr', socketAddr,
    '--verbosity', String(verbosity),
  ]

  if (options?.genesisPath !== undefined) args.push('--genesis-path', options.genesisPath)
  if (options?.storagePath !== undefined) {
    args.push(options.storagePath === '' ? '--storage' : `--storage=${options.storagePath}`)
  }
  if (options?.clearStorage) args.push('--clear-storage')
  if (options?.manualBlockCreation) args.push('--manual-block-creation')

  return spawnDevnode(devnodePath, args, socketAddr, readyTimeout, verbose)
}

/**
 * Advances a running devnode by one or more empty blocks.
 *
 * Spawns `aleo-devnode advance` as a child process (requires the binary on
 * PATH) and resolves when it exits. Use it to move the chain forward when the
 * node runs with `manualBlockCreation`, or when a test needs height to pass.
 *
 * @param options.numBlocks Blocks to produce. Defaults to 1.
 * @param options.socketAddr Devnode to target. Defaults to `127.0.0.1:3030`.
 * @throws If the binary is missing or no devnode answers on the socket.
 */
export async function advanceDevnode(options?: DevnodeAdvanceOptions): Promise<void> {
  const devnodePath = options?.devnodePath ?? 'aleo-devnode'
  const args = ['advance']
  if (options?.numBlocks !== undefined) args.push(String(options.numBlocks))
  if (options?.socketAddr) args.push('--socket-addr', options.socketAddr)
  await runDevnode(devnodePath, args)
}

/**
 * Restores a devnode ledger from a named snapshot.
 *
 * Spawns `aleo-devnode restore` as a child process (requires the binary on
 * PATH). With `restart: true` the devnode is relaunched on the restored
 * ledger; otherwise only the storage directory is rewritten and the caller
 * starts the node separately.
 *
 * @param options Snapshot name, target storage directory, and optional
 *   restart parameters.
 * @throws If the binary is missing, the snapshot does not exist, or the
 *   command exits non-zero.
 */
export async function restoreDevnode(options: DevnodeRestoreOptions): Promise<void> {
  const devnodePath = options.devnodePath ?? 'aleo-devnode'
  const args = ['restore', '--snapshot', options.snapshot]
  if (options.storage) args.push('--storage', options.storage)
  if (options.restart) {
    args.push('--restart')
    if (options.privateKey) args.push('--private-key', options.privateKey)
    if (options.socketAddr) args.push('--socket-addr', options.socketAddr)
    if (options.verbosity !== undefined) args.push('--verbosity', String(options.verbosity))
    if (options.manualBlockCreation) args.push('--manual-block-creation')
  }
  await runDevnode(devnodePath, args)
}

// =============================================================================
// Subprocess helpers
// =============================================================================

async function tryShutdownExisting(socketAddr: string): Promise<void> {
  const baseUrl = `http://${socketAddr}`
  try {
    const res = await fetch(`${baseUrl}/testnet/shutdown`, {
      method: 'POST',
      signal: AbortSignal.timeout(2_000),
    })
    if (!res.ok) return
    // Wait up to 5s for the old process to stop responding
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      try {
        await fetch(`${baseUrl}${HEALTH_CHECK_PATH}`, { signal: AbortSignal.timeout(500) })
        await new Promise<void>(r => setTimeout(r, 200))
      } catch {
        return // port no longer responding — old devnode is gone
      }
    }
  } catch {
    // nothing was listening on the port — proceed normally
  }
}

function runDevnode(devnodePath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(devnodePath, args, { stdio: 'inherit' })
    proc.on('error', (err) =>
      reject(
        new Error(
          `Failed to run ${devnodePath}: ${err.message}. Ensure aleo-devnode is installed and on PATH.`,
        ),
      ),
    )
    proc.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${devnodePath} ${args[0]} exited with code ${code}`))
    })
  })
}

async function spawnDevnode(
  devnodePath: string,
  args: string[],
  socketAddr: string,
  readyTimeout: number,
  verbose: boolean = false,
): Promise<DevnodeInstance> {
  const proc = spawn(devnodePath, args, {
    stdio: 'pipe',
    // MUST mirror DEVNODE_CONSENSUS_HEIGHTS in @veil/provable-sdk so the
    // transaction builder and the node agree on active consensus versions.
    env: { ...process.env, CONSENSUS_VERSION_HEIGHTS: process.env.CONSENSUS_VERSION_HEIGHTS || '0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16' },
  })

  if (verbose) {
    const port = socketAddr.split(':')[1] ?? socketAddr.replace(/\./g, '-')
    const logFile = join(process.cwd(), `devnode-${port}.log`)
    const logStream = createWriteStream(logFile, { flags: 'w' })
    proc.stdout?.pipe(logStream)
    proc.stderr?.pipe(logStream)
    console.log(`[devnode] logs → ${logFile}`)
  } else {
    proc.stdout?.resume()
    proc.stderr?.resume()
  }

  let startError: Error | undefined
  proc.on('error', (err) => {
    startError = new Error(
      `Failed to start ${devnodePath}: ${err.message}. Ensure aleo-devnode is installed and on PATH.`,
    )
  })
  proc.on('exit', (code, signal) => {
    if (signal === 'SIGTERM' || signal === 'SIGINT') return
    if (code !== 0 && code !== null) {
      startError = startError ?? new Error(`${devnodePath} exited unexpectedly with code ${code}`)
    }
  })

  try {
    await waitForReady(`http://${socketAddr}`, readyTimeout, () => startError)
  } catch (err) {
    proc.kill('SIGTERM')
    throw err
  }

  return {
    socketAddr,
    stop: () =>
      new Promise<void>((resolve) => {
        proc.kill('SIGTERM')
        proc.once('exit', () => resolve())
      }),
  }
}

// =============================================================================
// Test client decorator
// =============================================================================

/**
 * Devnode management actions added to a test client by {@link devnodeActions}.
 *
 * Each action delegates to the standalone function of the same name and
 * spawns the `aleo-devnode` binary.
 *
 * @property startDevnode Starts a devnode; see {@link startDevnode}.
 * @property advanceDevnode Produces blocks on a running devnode; see {@link advanceDevnode}.
 * @property restoreDevnode Restores a ledger snapshot; see {@link restoreDevnode}.
 */
export type DevnodeClientActions = {
  startDevnode: (options?: DevnodeStartOptions) => Promise<DevnodeInstance>
  advanceDevnode: (options?: DevnodeAdvanceOptions) => Promise<void>
  restoreDevnode: (options: DevnodeRestoreOptions) => Promise<void>
}

/**
 * Adds devnode management actions to a test client via `.extend`.
 *
 * @example
 * ```ts
 * import { createTestClient, http } from '@veil/core'
 * import { devnodeActions } from '@veil/devnode'
 *
 * const client = createTestClient({ transport: http('http://127.0.0.1:3030', { network: 'testnet' }) })
 *   .extend(devnodeActions)
 *
 * const devnode = await client.startDevnode()
 * await client.advanceDevnode({ numBlocks: 1 })
 * await devnode.stop()
 * ```
 */
export function devnodeActions(_client: Client): DevnodeClientActions {
  return {
    startDevnode: (options) => startDevnode(options),
    advanceDevnode: (options) => advanceDevnode(options),
    restoreDevnode: (options) => restoreDevnode(options),
  }
}

async function waitForReady(
  baseUrl: string,
  timeout: number,
  getError: () => Error | undefined,
): Promise<void> {
  const deadline = Date.now() + timeout
  const healthUrl = `${baseUrl}${HEALTH_CHECK_PATH}`

  while (Date.now() < deadline) {
    const err = getError()
    if (err) throw err

    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(HEALTH_CHECK_REQUEST_TIMEOUT_MS),
      })
      if (response.ok) return
    } catch {
      // not ready yet — keep polling
    }

    await new Promise<void>((resolve) => setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS))
  }

  throw new Error(
    `Devnode at ${baseUrl} did not become ready within ${timeout}ms. ` +
    'Try increasing readyTimeout or check that aleo-devnode is installed and working.',
  )
}
