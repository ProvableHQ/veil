import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'

/**
 * A sealed environment for tests that store or look up an Aleo account.
 *
 * Every test gets a fresh temporary directory holding the accounts directory,
 * the Shield Swap state directory and the home directory. The key, account
 * and password variables a developer's shell may carry are cleared first, and
 * the Keychain tool and the terminal are replaced, so nothing reads or writes
 * the developer's own accounts, state or Keychain.
 */

/** Variables a developer's shell could leak into a test. */
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

/** Test-only passwords. Never used for a funded account. */
export const PASSWORD = 'correct horse battery staple'
export const OTHER_PASSWORD = 'another test password'

export const posix = process.platform !== 'win32'

/** An in-memory stand-in for the macOS `security` tool. */
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

/** What one command left behind: exit status, standard output, standard error. */
export type Outcome = { status: number; out: string; err: string; json: any }

export type Sandbox = Awaited<ReturnType<typeof openSandbox>>

/**
 * Opens a sealed environment and loads fresh copies of the modules under test.
 *
 * The modules are loaded after the environment is in place, because the state
 * directory is read when the session module is first evaluated.
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
  // The keystore's process-level facilities. Not part of the SDK's public
  // entry points; reached by path so the Keychain tool can be replaced.
  const { runtime } = await import('../../provable-sdk/src/keystore/runtime.js')
  runtime.platform = 'darwin'
  runtime.homedir = () => home
  runtime.security = security.run
  runtime.terminalAttached = () => flags.terminal
  runtime.promptHidden = answer
  runtime.notify = (message) => void notes.push(message)

  const sdk = await import('@provablehq/veil-aleo-sdk')
  const keystore = await import('@provablehq/veil-aleo-sdk/node')
  // Proof that the facilities replaced above are the ones the keystore uses:
  // a lookup under "~" must land in the temporary home. Nothing below runs
  // otherwise, so the real Keychain is never reached.
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
  // A real exit ends the process at once. The stand-in throws to stop the
  // command, and records the code, because a command may catch what is thrown.
  const exits: number[] = []
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    exits.push(Number(code ?? 0))
    throw new Error(`EXIT:${code}`)
  })

  /** Runs a command's `main` and collects its exit status and output. */
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
    // The first exit is the one a real process would have taken.
    const status = exits[0] ?? Number(process.exitCode ?? 0)
    process.exitCode = undefined
    const text = out.join('\n')
    return {
      status,
      out: text,
      // Notes and errors of the keystore and the command go through the
      // replaced terminal; usage text goes to console.error.
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
    /** Restores the environment and removes the temporary directory. */
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

/** The permission bits of a file or directory. */
export function mode(path: string): number {
  return statSync(path).mode & 0o777
}
