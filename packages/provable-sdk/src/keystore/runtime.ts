import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { StringDecoder } from 'node:string_decoder'
import { KeystoreError } from './errors.js'

/** Full path of the macOS Keychain tool. Never resolved through `PATH`. */
const SECURITY_PATH = '/usr/bin/security'

/** Upper bound on one `security` invocation, in milliseconds. */
const SECURITY_TIMEOUT_MS = 15_000

/**
 * Outcome of one `security` invocation.
 *
 * @property status Exit status, or `null` when the tool could not be started,
 *   was killed by a signal or exceeded the time limit.
 * @property stdout Standard output. Holds the secret for a read.
 */
export type SecurityResult = { status: number | null; stdout: string }

/**
 * Runs the macOS `security` tool with the given arguments.
 *
 * @param args Arguments passed after the tool's path.
 * @param stdin Optional text written to the tool's standard input, used to keep
 *   a secret out of the process arguments.
 */
export type SecurityRunner = (args: readonly string[], stdin?: string) => Promise<SecurityResult>

/**
 * Terminal input the hidden prompt reads from: a TTY stream that can switch
 * echo and line buffering off. `process.stdin` satisfies it when it is a
 * terminal.
 *
 * @property isRaw Whether the stream is in raw mode before the prompt starts;
 *   the prompt restores this mode when it ends.
 * @property setRawMode Switches raw mode, in which typed characters are neither
 *   echoed nor held back until Enter.
 * @property resume Starts delivery of typed input.
 * @property pause Stops delivery, so a pending read does not keep the process
 *   alive.
 * @property on Subscribes to typed input (`data`) or the end of input (`end`).
 * @property off Removes a subscription made with `on`.
 */
export type HiddenInput = {
  isRaw?: boolean
  setRawMode(mode: boolean): unknown
  resume(): unknown
  pause(): unknown
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown
  on(event: 'end', listener: () => void): unknown
  off(event: 'data', listener: (chunk: Buffer | string) => void): unknown
  off(event: 'end', listener: () => void): unknown
}

/** Runs `/usr/bin/security` as a child process with a 15 second limit. */
const runSecurity: SecurityRunner = (args, stdin) =>
  new Promise((resolve) => {
    let stdout = ''
    let settled = false
    const child = spawn(SECURITY_PATH, [...args], { stdio: ['pipe', 'pipe', 'ignore'] })
    const settle = (status: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ status, stdout })
    }
    // A hung tool (for example one waiting on a Keychain dialog) is killed and
    // reported as a failure instead of blocking the caller.
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      settle(null)
    }, SECURITY_TIMEOUT_MS)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.on('error', () => settle(null))
    child.on('close', (status) => settle(status))
    // A tool that exits before reading its input must not crash the process.
    child.stdin.on('error', () => undefined)
    child.stdin.end(stdin ?? '')
  })

/**
 * Reads one line from a terminal without echoing it.
 *
 * Switches the input to raw mode for the duration of the read and restores the
 * previous mode afterwards. Enter submits, Backspace deletes one character,
 * Ctrl-U clears the line and Ctrl-C cancels.
 *
 * @param input Terminal stream to read from.
 * @param output Stream the prompt text is written to. MUST be the terminal,
 *   not standard output.
 * @param message Prompt text shown before the cursor.
 * @returns The typed line, without the line ending.
 * @throws KeystoreError `PASSWORD_REQUIRED` when the prompt is cancelled or the
 *   input ends before a line is submitted.
 */
export function readHidden(
  input: HiddenInput,
  output: { write(text: string): unknown },
  message: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8')
    const wasRaw = input.isRaw === true
    let value = ''

    const finish = (error?: KeystoreError) => {
      input.off('data', onData)
      input.off('end', onEnd)
      input.setRawMode(wasRaw)
      input.pause()
      // Echo is off, so the Enter keypress did not move the cursor.
      output.write('\n')
      if (error) reject(error)
      else resolve(value)
    }
    const cancelled = () => new KeystoreError('PASSWORD_REQUIRED', 'The password prompt was cancelled.')
    const onEnd = () => finish(cancelled())
    const onData = (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : decoder.write(chunk)
      for (const char of text) {
        if (char === '\r' || char === '\n' || char === '\u0004') return finish()
        if (char === '\u0003') return finish(cancelled())
        if (char === '\u007f' || char === '\b') value = [...value].slice(0, -1).join('')
        else if (char === '\u0015') value = ''
        else value += char
      }
    }

    output.write(message)
    input.setRawMode(true)
    input.resume()
    input.on('data', onData)
    input.on('end', onEnd)
  })
}

/**
 * Process-level facilities the keystore depends on.
 *
 * Kept in one object so tests can substitute the Keychain tool, the platform,
 * the home directory and the terminal. Not exported from the package.
 *
 * @property platform Operating system identifier, as `process.platform`.
 * @property homedir Returns the current user's home directory.
 * @property security Runs the macOS `security` tool.
 * @property terminalAttached Reports whether a person can answer a prompt:
 *   standard input and standard error are both terminals.
 * @property promptHidden Asks for one line on the terminal without echo.
 * @property notify Writes one line to the terminal, never to standard output.
 */
export type KeystoreRuntime = {
  platform: NodeJS.Platform
  homedir: () => string
  security: SecurityRunner
  terminalAttached: () => boolean
  promptHidden: (message: string) => Promise<string>
  notify: (message: string) => void
}

/** The live facilities: the real platform, Keychain tool and terminal. */
export const runtime: KeystoreRuntime = {
  platform: process.platform,
  homedir,
  security: runSecurity,
  terminalAttached: () => process.stdin.isTTY === true && process.stderr.isTTY === true,
  promptHidden: (message) => readHidden(process.stdin, process.stderr, message),
  notify: (message) => {
    process.stderr.write(`${message}\n`)
  },
}
