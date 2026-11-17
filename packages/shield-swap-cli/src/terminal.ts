/**
 * Provides terminal prompts and output checks for account commands.
 *
 * Hidden prompts accept keys, recovery phrases, and passwords without echo.
 * Prompts and notices go to standard error.
 */
import { createInterface } from 'node:readline'
import { StringDecoder } from 'node:string_decoder'

/**
 * Defines the input stream required by a hidden terminal prompt.
 *
 * Raw mode delivers each character without echoing it or waiting for Enter.
 *
 * @property isRaw Whether raw mode is already enabled. If omitted, the prompt
 *   restores the stream to non-raw mode when it ends.
 * @property setRawMode Enables or disables raw mode.
 * @property resume Starts delivering input events.
 * @property pause Stops delivering input events so the stream does not keep
 *   the process running.
 * @property on Registers a listener for input data or the end of the stream.
 * @property off Removes a registered listener.
 *
 * @example
 * const input: HiddenInput = process.stdin
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
 * Reads a line of terminal input without echoing its contents.
 *
 * Restores the previous input mode when the prompt ends. Enter or Ctrl-D
 * submits the line; Backspace deletes one character; Ctrl-U clears the line.
 * Ctrl-C or the end of the input stream cancels the prompt.
 *
 * @param input Terminal stream that supports raw mode.
 * @param output Terminal stream for the prompt text, normally standard error.
 * @param message Prompt text to display before reading input.
 * @returns The entered line without its line ending, or an empty string if
 *   the prompt is cancelled.
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
      // Write the newline that the terminal would normally echo for Enter.
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
 * Prompts for a line of text and echoes the response.
 *
 * Writes the prompt to standard error and reads from standard input.
 *
 * @param message Prompt text to display before reading input.
 * @returns The response without its line ending, or an empty string if
 *   the input stream closes before a response is submitted.
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
    // Treat a closed input stream as an empty response.
    reader.on('close', () => {
      if (!answered) resolve('')
    })
  })
}

/**
 * Defines terminal access used by account commands.
 *
 * @property platform Operating system identifier from `process.platform`.
 * @property attached Checks whether standard input and standard error are terminals.
 * @property outputIsTerminal Checks whether standard output is a terminal.
 * @property promptHidden Reads a line without echoing it. Returns an empty string
 *   if the prompt is cancelled.
 * @property promptVisible Reads and echoes a line for a non-secret confirmation.
 * @property notify Writes a notice to standard error followed by a newline.
 *
 * @example
 * const attached: boolean = terminal.attached()
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
 * Provides account commands with the current process's terminal streams.
 *
 * Use `attached` before prompting and `outputIsTerminal` before printing
 * secrets. Tests can replace these methods to supply input and capture output.
 *
 * @example
 * if (terminal.attached()) {
 *   const answer = await terminal.promptVisible('Continue? [y/N] ')
 * }
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
