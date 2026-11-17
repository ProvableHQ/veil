import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'

/**
 * Isolates account tests from the developer's credentials and files.
 *
 * Uses temporary home, account, and session directories. Clears credential
 * variables and replaces Keychain and terminal access for each test.
 */

/** Lists environment settings to clear before each account test. */
const VARIABLES = [
  'ALEO_PRIVATE_KEY',
  'ALEO_PRIVATE_KEY_FILE',
  'ALEO_ACCOUNT',
  'ALEO_ACCOUNTS_DIR',
  'ALEO_ACCOUNT_PASSWORD',
  'SHIELD_SWAP_PRIVATE_KEY',
  'SHIELD_SWAP_PRIVATE_KEY_FILE',
  'SHIELD_SWAP_STATE_DIR',
  'SHIELD_SWAP_NETWORK',
  'SHIELD_SWAP_API_URL',
  'VEIL_INVENTORY_DB',
  'HOME',
  'USERPROFILE',
] as const

/** Supplies a password for encrypted test accounts. */
export const PASSWORD = 'correct horse battery staple'
/** Supplies a different password for rejection and password-change tests. */
export const OTHER_PASSWORD = 'another test password'

/** Indicates whether to assert POSIX file permission bits. */
export const posix = process.platform !== 'win32'

/** Simulates Keychain reads and writes in memory and records command calls. */
function fakeSecurity() {
  const entries = new Map<string, string>()
  const calls: Array<{ args: string[]; stdin?: string }> = []
  const run = async (args: readonly string[], stdin?: string): Promise<{ status: number | null; stdout: string }> => {
    calls.push({ args: [...args], stdin })
    if (args.length === 1 && args[0] === '-i') {
      const match = /^add-generic-password -U -s (\S+) -a (\S+) -l (\S+) -w (\S+)\n$/.exec(stdin ?? '')
      if (!match) return { status: 1, stdout: '' }
      entries.set(`${match[1]} ${match[2]}`, match[4]!)
      return { status: 0, stdout: '' }
    }
    if (args.length === 6 && args[0] === 'find-generic-password' && args[1] === '-s' && args[3] === '-a' && args[5] === '-w') {
      const value = entries.get(`${args[2]} ${args[4]}`)
      return value === undefined ? { status: 44, stdout: '' } : { status: 0, stdout: `${value}\n` }
    }
    if (args.length === 5 && args[0] === 'delete-generic-password' && args[1] === '-s' && args[3] === '-a') {
      return entries.delete(`${args[2]} ${args[4]}`) ? { status: 0, stdout: '' } : { status: 44, stdout: '' }
    }
    return { status: 1, stdout: '' }
  }
  return { entries, calls, run }
}

/**
 * Captures a command's exit status and output for assertions.
 *
 * @property status First requested exit code, or the final process exit code.
 * @property out Captured standard output joined with newlines.
 * @property err Captured errors and terminal notices joined with newlines.
 * @property json Parses standard output as JSON when accessed; throws for
 *   output that is not valid JSON.
 *
 * @example
 * const sandbox = await openSandbox()
 * const { main } = await import('../src/commands/account.js')
 * const outcome: Outcome = await sandbox.run(main, ['show', '--json'])
 * sandbox.close()
 */
export type Outcome = { status: number; out: string; err: string; json: any }

/**
 * Provides temporary account files, mocked system access, and command capture.
 *
 * Call `close()` after each test to restore process settings and remove files.
 *
 * @example
 * const sandbox: Sandbox = await openSandbox()
 * sandbox.close()
 */
export type Sandbox = Awaited<ReturnType<typeof openSandbox>>

/**
 * Creates an isolated environment for account tests.
 *
 * Clears credential variables, creates temporary directories, and replaces
 * terminal and Keychain access. Loads fresh modules after setting the paths
 * because state paths are read during module initialization.
 *
 * @returns Test paths, mocked services, captured input and output, a command
 *   runner, and `close()` to restore the environment and remove test files.
 * @throws If setup fails or the keystore does not use the replaced runtime.
 *
 * @example
 * const sandbox = await openSandbox()
 * try {
 *   const { main } = await import('../src/commands/account.js')
 *   const outcome = await sandbox.run(main, ['show', '--json'])
 * } finally {
 *   sandbox.close()
 * }
 */
export async function openSandbox() {
  const savedEnv: Record<string, string | undefined> = {}
  for (const name of VARIABLES) {
    savedEnv[name] = process.env[name]
    delete process.env[name]
  }
  const root = mkdtempSync(join(tmpdir(), 'shield-swap-account-'))
  const home = join(root, 'home')
  const dir = join(root, 'accounts')
  const stateRoot = join(root, 'state')
  mkdirSync(home)
  process.env.HOME = home
  process.env.USERPROFILE = home
  process.env.ALEO_ACCOUNTS_DIR = dir
  process.env.SHIELD_SWAP_STATE_DIR = stateRoot

  const security = fakeSecurity()
  const notes: string[] = []
  const prompts: string[] = []
  const answers: string[] = []
  const out: string[] = []
  const err: string[] = []
  const flags = { terminal: false, outputTerminal: false }
  const answer = async (message: string) => {
    prompts.push(message)
    const next = answers.shift()
    if (next === undefined) throw new Error('unexpected prompt')
    return next
  }

  vi.resetModules()
  // Import the internal runtime to replace Keychain and terminal access.
  const { runtime } = await import('../../provable-sdk/src/keystore/runtime.js')
  runtime.platform = 'darwin'
  runtime.homedir = () => home
  runtime.security = security.run
  runtime.terminalAttached = () => flags.terminal
  runtime.promptHidden = answer
  runtime.notify = (message) => void notes.push(message)

  const sdk = await import('@provablehq/veil-aleo-sdk')
  const keystore = await import('@provablehq/veil-aleo-sdk/node')
  // Verify that the keystore uses the temporary home before running commands.
  const probe = await keystore.loadAccount({ dir: '~/probe', prompt: false }).catch((error: Error) => error.message)
  if (typeof probe !== 'string' || !probe.includes(join(home, 'probe'))) {
    throw new Error('the keystore under test does not use the replaced runtime')
  }

  const { terminal } = await import('../src/terminal.js')
  terminal.platform = 'darwin'
  terminal.attached = () => flags.terminal
  terminal.outputIsTerminal = () => flags.outputTerminal
  terminal.promptHidden = answer
  terminal.promptVisible = answer
  terminal.notify = (message) => void notes.push(message)

  const previousExitCode = process.exitCode
  process.exitCode = undefined
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => void out.push(String(line)))
  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => void err.push(parts.map(String).join(' ')))
  // Record exit attempts separately because command code may catch the mock error.
  const exits: number[] = []
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    exits.push(Number(code ?? 0))
    throw new Error(`EXIT:${code}`)
  })

  /** Runs a command with captured output and records its first attempted exit. */
  const run = async (main: (argv: string[]) => Promise<void>, argv: string[]): Promise<Outcome> => {
    out.length = 0
    err.length = 0
    notes.length = 0
    process.exitCode = undefined
    exits.length = 0
    try {
      await main(argv)
    } catch (error) {
      if (!/^EXIT:\d+$/.test((error as Error).message)) throw error
    }
    // A real process would stop at the first exit call.
    const status = exits[0] ?? Number(process.exitCode ?? 0)
    process.exitCode = undefined
    const text = out.join('\n')
    return {
      status,
      out: text,
      // Combine captured console errors with notices from the mocked terminal.
      err: [...err, ...notes].join('\n'),
      get json() {
        return JSON.parse(text)
      },
    }
  }

  return {
    root,
    home,
    dir,
    stateRoot,
    security,
    notes,
    prompts,
    answers,
    flags,
    runtime,
    terminal,
    sdk,
    keystore,
    run,
    /** Restores mocks, environment, and exit status, then removes test files. */
    close() {
      vi.restoreAllMocks()
      process.exitCode = previousExitCode
      for (const name of VARIABLES) {
        if (savedEnv[name] === undefined) delete process.env[name]
        else process.env[name] = savedEnv[name]
      }
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/**
 * Reads a file or directory's POSIX permission bits.
 *
 * @param path File or directory to inspect.
 * @returns Permission bits masked to 0o777.
 * @throws If the path cannot be inspected.
 *
 * @example
 * const permissions = mode(tmpdir())
 */
export function mode(path: string): number {
  return statSync(path).mode & 0o777
}
