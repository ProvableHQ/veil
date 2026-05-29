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

export type DevnodeAdvanceOptions = {
  /** Number of blocks to advance. Defaults to 1. */
  numBlocks?: number
  /** `--socket-addr`. Target devnode socket. Defaults to `DEVNODE_ADDR`. */
  socketAddr?: string
  /** Path to the aleo-devnode binary. Defaults to `'aleo-devnode'` (resolved on PATH). */
  devnodePath?: string
}

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

export type DevnodeInstance = {
  /** Socket address the devnode is listening on. */
  socketAddr: string
  /** Terminates the devnode process gracefully (SIGTERM). */
  stop: () => Promise<void>
}

// =============================================================================
// Public API
// =============================================================================

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

export async function advanceDevnode(options?: DevnodeAdvanceOptions): Promise<void> {
  const devnodePath = options?.devnodePath ?? 'aleo-devnode'
  const args = ['advance']
  if (options?.numBlocks !== undefined) args.push(String(options.numBlocks))
  if (options?.socketAddr) args.push('--socket-addr', options.socketAddr)
  await runDevnode(devnodePath, args)
}

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
    env: { ...process.env, CONSENSUS_VERSION_HEIGHTS: process.env.CONSENSUS_VERSION_HEIGHTS || '0,1,2,3,4,5,6,7,8,9,10,11,12,13' },
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
 * await client.advanceBlock({ count: 1 })
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
