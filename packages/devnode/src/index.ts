import { spawn } from 'node:child_process'

/** The well-known seeded private key used by Aleo Devnode */
export const DEVNODE_PRIVATE_KEY = 'APrivateKey1zkp8CZNn3yeCseEtxuVPbDCwSyhGW6yZKUYKfgXmcpoGPWH'

/** Default local devnode socket address */
export const DEVNODE_ADDR = '127.0.0.1:3030'

const HEALTH_CHECK_PATH = '/mainnet/block/height/latest'
const HEALTH_CHECK_INTERVAL_MS = 250
const HEALTH_CHECK_REQUEST_TIMEOUT_MS = 1_000

export type DevnodeOptions = {
  /** Aleo private key for the genesis account. Defaults to the well-known seeded key. */
  privateKey?: string
  /** Socket address for the REST API. Defaults to "127.0.0.1:3030". */
  socketAddr?: string
  /** Log verbosity (0–2). Defaults to 2. */
  verbosity?: 0 | 1 | 2
  /** Path to a custom genesis block file. */
  genesisPath?: string
  /**
   * Directory for persistent ledger storage.
   * - Omit for in-memory (ephemeral, no persistence across restarts).
   * - Pass an empty string to use the default "./devnode" directory.
   * - Pass a path string for a custom directory.
   */
  storagePath?: string
  /** Clear the storage directory before starting. Requires storagePath. */
  clearStorage?: boolean
  /** Disable automatic block creation after broadcast. */
  manualBlockCreation?: boolean
  /** Milliseconds to wait for the devnode REST API to become ready. Defaults to 30000. */
  readyTimeout?: number
}

export type DevnodeInstance = {
  /** The socket address the devnode is listening on. */
  socketAddr: string
  /** Terminates the devnode process. */
  stop: () => Promise<void>
}

/**
 * Starts a local Aleo Devnode by invoking the Leo CLI.
 *
 * Devnode bypasses consensus and skips ZK proof verification, enabling rapid
 * program iteration. It does charge fees — the genesis account (seeded with
 * DEVNODE_PRIVATE_KEY) is pre-funded for this purpose.
 *
 * Resolves once the devnode REST API is accepting requests. Throws if the Leo CLI
 * is not found, the process exits unexpectedly, or the ready timeout is exceeded.
 *
 * Requires the Leo CLI to be installed: https://developer.aleo.org/leo/installation
 *
 * @example
 * ```ts
 * const devnode = await startDevnode()
 * // ... run tests against http://127.0.0.1:3030 ...
 * await devnode.stop()
 * ```
 *
 * @example
 * ```ts
 * // Vitest integration suite
 * let devnode: DevnodeInstance
 *
 * beforeAll(async () => { devnode = await startDevnode() })
 * afterAll(async () => { await devnode.stop() })
 * ```
 */
export async function startDevnode(options?: DevnodeOptions): Promise<DevnodeInstance> {
  const privateKey = options?.privateKey ?? DEVNODE_PRIVATE_KEY
  const socketAddr = options?.socketAddr ?? DEVNODE_ADDR
  const verbosity = options?.verbosity ?? 2
  const readyTimeout = options?.readyTimeout ?? 30_000

  const args = [
    'devnode', 'start',
    '--private-key', privateKey,
    '--socket-addr', socketAddr,
    '--verbosity', String(verbosity),
  ]

  if (options?.genesisPath !== undefined) {
    args.push('--genesis-path', options.genesisPath)
  }
  if (options?.storagePath !== undefined) {
    // --storage accepts an optional path; passing empty string uses the CLI default ("devnode")
    args.push(options.storagePath === '' ? '--storage' : `--storage=${options.storagePath}`)
  }
  if (options?.clearStorage) {
    args.push('--clear-storage')
  }
  if (options?.manualBlockCreation) {
    args.push('--manual-block-creation')
  }

  const proc = spawn('leo', args, { stdio: 'pipe' })

  let startError: Error | undefined

  proc.on('error', (err) => {
    startError = new Error(
      `Failed to start leo devnode: ${err.message}. ` +
      'Ensure the Leo CLI is installed: https://developer.aleo.org/leo/installation',
    )
  })

  proc.on('exit', (code, signal) => {
    if (signal === 'SIGTERM') return
    if (code !== 0 && code !== null) {
      startError = startError ?? new Error(`leo devnode exited unexpectedly with code ${code}`)
    }
  })

  await waitForReady(`http://${socketAddr}`, readyTimeout, () => startError)

  return {
    socketAddr,
    stop: () =>
      new Promise<void>((resolve) => {
        proc.kill('SIGTERM')
        proc.once('exit', () => resolve())
      }),
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
    'Try increasing readyTimeout or check that the Leo CLI is installed and working.',
  )
}
