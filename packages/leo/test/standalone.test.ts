import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

import { abi, run, build, clean } from '../src/index.js'

/** Builds a fake child process that emits stdout then exits. */
function fakeProc({ stdout = '', code = 0 }: { stdout?: string; code?: number } = {}) {
  const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter }
  proc.stdout = new EventEmitter()
  queueMicrotask(() => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout))
    proc.emit('exit', code)
  })
  return proc
}

beforeEach(() => {
  spawnMock.mockReset()
  spawnMock.mockImplementation(() => fakeProc())
})

describe('standalone abi', () => {
  it('spawns `leo abi <file>` and returns the captured output', async () => {
    spawnMock.mockImplementation(() => fakeProc({ stdout: '{"functions":[]}' }))

    const out = await abi({ file: 'build/main.aleo', cwd: '/proj' })

    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [bin, args, opts] = spawnMock.mock.calls[0]
    expect(bin).toBe('leo')
    expect(args).toEqual(['abi', 'build/main.aleo'])
    expect(opts.cwd).toBe('/proj')
    // stdout must be piped, not inherited, or the capture silently returns ''
    expect(opts.stdio).toEqual(['ignore', 'pipe', 'inherit'])
    expect(out).toBe('{"functions":[]}')
  })

  it('rejects when the abi command exits non-zero', async () => {
    spawnMock.mockImplementation(() => fakeProc({ code: 1 }))
    await expect(abi({ file: 'build/main.aleo' })).rejects.toThrow(/exited with code 1/)
  })
})

describe('standalone run', () => {
  it('spawns `leo run <function> [inputs...]` in the project directory', async () => {
    await run({ function: 'mint', inputs: ['aleo1abc', '1000u64'], cwd: '/proj' })

    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [bin, args, opts] = spawnMock.mock.calls[0]
    expect(bin).toBe('leo')
    expect(args).toEqual(['run', 'mint', 'aleo1abc', '1000u64'])
    expect(opts.cwd).toBe('/proj')
  })

  it('omits inputs when none are given', async () => {
    await run({ function: 'init' })
    expect(spawnMock.mock.calls[0][1]).toEqual(['run', 'init'])
  })
})

describe('standalone build and clean still spawn their own commands', () => {
  it('build spawns `leo build`', async () => {
    await build({ cwd: '/proj' })
    expect(spawnMock.mock.calls[0][1]).toEqual(['build'])
  })

  it('clean spawns `leo clean`', async () => {
    await clean({ cwd: '/proj' })
    expect(spawnMock.mock.calls[0][1]).toEqual(['clean'])
  })
})
