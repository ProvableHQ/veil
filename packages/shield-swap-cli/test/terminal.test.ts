import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { readHiddenLine, type HiddenInput } from '../src/terminal.js'

/**
 * Tests hidden input, line editing, cancellation, and terminal mode restoration.
 *
 * Simulated streams supply input and capture prompt output.
 */

/** Simulates terminal input and records raw mode and flow changes. */
function fakeInput() {
  const emitter = new EventEmitter()
  const modes: boolean[] = []
  let flowing = false
  const input: HiddenInput = {
    isRaw: false,
    setRawMode: (mode) => void modes.push(mode),
    resume: () => void (flowing = true),
    pause: () => void (flowing = false),
    on: (event: string, listener: (...args: any[]) => void) => emitter.on(event, listener),
    off: (event: string, listener: (...args: any[]) => void) => emitter.off(event, listener),
  }
  return { input, emitter, modes, isFlowing: () => flowing }
}

/** Captures writes to a simulated terminal output stream. */
function fakeOutput() {
  const written: string[] = []
  return { written, write: (text: string) => void written.push(text) }
}

describe('readHiddenLine', () => {
  it('returns the typed line without echoing it, and restores the terminal', async () => {
    const { input, emitter, modes, isFlowing } = fakeInput()
    const output = fakeOutput()
    const line = readHiddenLine(input, output, 'Secret: ')
    expect(isFlowing()).toBe(true)
    emitter.emit('data', Buffer.from('not shown'))
    emitter.emit('data', '\r')
    expect(await line).toBe('not shown')
    // Prompt output must contain no typed characters.
    expect(output.written).toEqual(['Secret: ', '\n'])
    expect(modes).toEqual([true, false])
    expect(isFlowing()).toBe(false)
    expect(emitter.listenerCount('data') + emitter.listenerCount('end')).toBe(0)
  })

  it('edits the line with Backspace and Ctrl-U, and submits on Ctrl-D', async () => {
    const { input, emitter } = fakeInput()
    const line = readHiddenLine(input, fakeOutput(), 'Secret: ')
    emitter.emit('data', 'wrong\u0015abd\u007fc\u0004ignored')
    expect(await line).toBe('abc')
  })

  it('keeps a multi-byte character that arrives in two chunks whole', async () => {
    const { input, emitter } = fakeInput()
    const line = readHiddenLine(input, fakeOutput(), 'Secret: ')
    const bytes = Buffer.from('é\n')
    emitter.emit('data', bytes.subarray(0, 1))
    emitter.emit('data', bytes.subarray(1))
    expect(await line).toBe('é')
  })

  it('returns nothing when the prompt is cancelled or the input ends', async () => {
    const cancelled = fakeInput()
    const first = readHiddenLine(cancelled.input, fakeOutput(), 'Secret: ')
    cancelled.emitter.emit('data', 'typed\u0003')
    expect(await first).toBe('')
    expect(cancelled.modes).toEqual([true, false])

    const ended = fakeInput()
    const second = readHiddenLine(ended.input, fakeOutput(), 'Secret: ')
    ended.emitter.emit('data', 'typed')
    ended.emitter.emit('end')
    expect(await second).toBe('')
  })
})
