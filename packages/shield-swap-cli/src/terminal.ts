/**
 * Terminal access for the `shield-swap account` commands.
 *
 * Internal to the package. Holds the hidden prompt a key or a recovery phrase
 * is pasted into, the visible confirmation before a key is shown, and the
 * checks that decide whether a person is there to answer. Kept in one object
 * so tests can replace the terminal.
 */
import { createInterface } from 'node:readline'
import { StringDecoder } from 'node:string_decoder'

/**
 * Terminal input a hidden prompt reads from: a TTY stream that can switch echo
 * and line buffering off. `process.stdin` satisfies it when it is a terminal.
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

/**
 * Reads one line from a terminal without echoing it.
 *
 * Switches the input to raw mode for the duration of the read and restores the
 * previous mode afterwards. Enter or Ctrl-D submits, Backspace deletes one
 * character and Ctrl-U clears the line. Ctrl-C, or the end of the input,
 * cancels: the result is then empty, which a caller treats as nothing entered.
 *
 * @param input Terminal stream to read from.
 * @param output Stream the prompt text is written to. MUST be the terminal,
 *   not standard output.
 * @param message Prompt text shown before the cursor.
 * @returns The typed line without its line ending, or an empty string when the
 *   prompt was cancelled.
 *
 * @example
 * const typed = await readHiddenLine(process.stdin, process.stderr, 'Private key: ')
 */
export function readHiddenLine(
  input: HiddenInput,
  output: { write(text: string): unknown },
  message: string,
): Promise<string> {
  return new Promise((resolve) => {
    const decoder = new StringDecoder('utf8')
    const wasRaw = input.isRaw === true
    let value = ''

    const finish = (result: string) => {
      input.off('data', onData)
      input.off('end', onEnd)
      input.setRawMode(wasRaw)
      input.pause()
      // Echo is off, so the Enter keypress did not move the cursor.
      output.write('\n')
      resolve(result)
    }
    const onEnd = () => finish('')
    const onData = (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : decoder.write(chunk)
      for (const char of text) {
        if (char === '\r' || char === '\n' || char === '\u0004') return finish(value)
        if (char === '\u0003') return finish('')
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
 * Asks one question on the terminal and echoes the answer as it is typed.
 *
 * The question is written to standard error, never to standard output.
 *
 * @param message Question shown before the cursor.
 * @returns The answer without its line ending; empty when the input ended
 *   before a line was entered.
 */
function readVisibleLine(message: string): Promise<string> {
  return new Promise((resolve) => {
    const reader = createInterface({ input: process.stdin, output: process.stderr })
    let answered = false
    reader.question(message, (answer) => {
      answered = true
      reader.close()
      resolve(answer)
    })
    // Closed without an answer: the input ended, which is not a yes.
    reader.on('close', () => {
      if (!answered) resolve('')
    })
  })
}

/**
 * Platform and terminal access the account commands depend on.
 *
 * @property platform Operating system identifier, as `process.platform`.
 * @property attached Reports whether a person can answer a prompt: standard
 *   input and standard error are both terminals.
 * @property outputIsTerminal Reports whether standard output is a terminal,
 *   not a pipe or a file.
 * @property promptHidden Asks for one line on the terminal without echo.
 *   Resolves to an empty string when the prompt is cancelled.
 * @property promptVisible Asks for one line on the terminal with echo, for a
 *   confirmation that is not secret.
 * @property notify Writes one line to standard error, never to standard
 *   output.
 */
export type Terminal = {
  platform: NodeJS.Platform
  attached: () => boolean
  outputIsTerminal: () => boolean
  promptHidden: (message: string) => Promise<string>
  promptVisible: (message: string) => Promise<string>
  notify: (message: string) => void
}

/**
 * Terminal facilities of the running process.
 *
 * Tests replace its members to stand in for a person at a terminal.
 *
 * @example
 * if (terminal.attached()) terminal.notify('A person can answer a prompt.')
 */
export const terminal: Terminal = {
  platform: process.platform,
  attached: () => process.stdin.isTTY === true && process.stderr.isTTY === true,
  outputIsTerminal: () => process.stdout.isTTY === true,
  promptHidden: (message) => readHiddenLine(process.stdin, process.stderr, message),
  promptVisible: readVisibleLine,
  notify: (message) => {
    process.stderr.write(`${message}\n`)
  },
}
