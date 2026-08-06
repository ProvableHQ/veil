import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flags, reportUsage, confirmed, table, output, setJsonMode, run } from '../src/shared.js'

/**
 * The conventions every subcommand inherits. These are the safety properties of
 * the CLI — the `--execute` guard, the unknown-flag rejection, and the promise
 * that `--json` puts an object on stdout even when things go wrong — so they are
 * tested directly rather than through a command that would need a live session.
 */

const USAGE = 'usage: test'

let stdout: string[]
let stderr: string[]
let exitCode: number | undefined

beforeEach(() => {
  stdout = []
  stderr = []
  exitCode = undefined
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => void stdout.push(String(line)))
  vi.spyOn(console, 'error').mockImplementation((line: unknown) => void stderr.push(String(line)))
  vi.spyOn(console, 'warn').mockImplementation((line: unknown) => void stderr.push(String(line)))
  // process.exit is typed as `never`, so the stub has to throw to match: a stub
  // that returned would let execution continue past a call site that never does.
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code
    throw new Error(`EXIT:${code}`)
  }) as never)
  setJsonMode(false)
})

afterEach(() => {
  vi.restoreAllMocks()
  setJsonMode(false)
})

describe('flags', () => {
  it('parses a command\'s own flags alongside the common ones', () => {
    const args = flags({ from: { type: 'string' } }, USAGE, ['--from', 'USDCx', '--execute', '--network', 'mainnet'])
    expect(args.from).toBe('USDCx')
    expect(args.execute).toBe(true)
    expect(args.network).toBe('mainnet')
  })

  it('reads the argv it is given, not process.argv', () => {
    // The dispatcher strips the subcommand before calling main, so a helper that
    // reached for process.argv would see `swap` as a positional and reject it.
    const args = flags({ from: { type: 'string' } }, USAGE, ['--from', 'ETH'])
    expect(args.from).toBe('ETH')
  })

  it('rejects an unknown flag rather than ignoring it', () => {
    // A mistyped --amont that fell back to a default would submit a transaction
    // the caller never described.
    expect(() => flags({ amount: { type: 'string' } }, USAGE, ['--amont', '5'])).toThrow('EXIT:64')
    expect(stderr.join('\n')).toContain('--amont')
    expect(stderr.join('\n')).toContain(USAGE)
  })

  it('reports an unknown flag as JSON when --json was asked for', () => {
    // Parsing fails before setJsonMode can run, so --json is read from argv.
    expect(() => flags({ amount: { type: 'string' } }, USAGE, ['--amont', '5', '--json'])).toThrow('EXIT:64')
    expect(stderr).toEqual([])
    expect(JSON.parse(stdout.join('\n')).error.usage).toBe(USAGE)
  })

  it('prints usage and exits 0 for --help', () => {
    expect(() => flags({}, USAGE, ['--help'])).toThrow('EXIT:0')
    expect(stdout).toContain(USAGE)
  })
})

describe('reportUsage', () => {
  it('writes the message to stderr and exits 64', () => {
    expect(() => reportUsage('unknown command `swaps`', USAGE, [])).toThrow('EXIT:64')
    expect(exitCode).toBe(64)
    expect(stderr.join('\n')).toContain('unknown command `swaps`')
  })

  it('writes an object to stdout under --json, leaving stderr empty', () => {
    // A message on stderr with nothing on stdout leaves a caller that parses
    // stdout unable to tell a failure from a command that found nothing.
    expect(() => reportUsage('unknown command', USAGE, ['--json'])).toThrow('EXIT:64')
    expect(stderr).toEqual([])
    expect(JSON.parse(stdout.join('\n'))).toEqual({ error: { message: 'unknown command', usage: USAGE } })
  })
})

describe('confirmed', () => {
  const plan = [['sell', '1.5 USDCx'] as const, ['buy', '0.0004 ETH'] as const]

  it('refuses to proceed without --execute', () => {
    expect(confirmed({ execute: undefined, network: 'testnet', plan })).toBe(false)
    expect(stdout.join('\n')).toContain('nothing submitted')
  })

  it('proceeds with --execute', () => {
    expect(confirmed({ execute: true, network: 'testnet', plan })).toBe(true)
  })

  it('prints the plan either way, so a dry run shows what a real run would do', () => {
    confirmed({ execute: false, network: 'testnet', plan })
    const dry = stdout.join('\n')
    stdout = []
    confirmed({ execute: true, network: 'testnet', plan })
    expect(stdout.join('\n')).toBe(dry.replace(/\n*nothing submitted[\s\S]*/, ''))
  })

  it('names mainnet in the plan header', () => {
    confirmed({ execute: true, network: 'mainnet', plan })
    expect(stdout.join('\n')).toContain('MAINNET — real funds')
  })

  it('still returns the decision under --json, printing nothing', () => {
    setJsonMode(true)
    expect(confirmed({ execute: true, network: 'mainnet', plan })).toBe(true)
    expect(confirmed({ execute: undefined, network: 'mainnet', plan })).toBe(false)
    expect(stdout).toEqual([])
  })
})

describe('output', () => {
  it('calls the human renderer when a person is reading', () => {
    const human = vi.fn()
    output({ sold: 5n }, human)
    expect(human).toHaveBeenCalledWith({ sold: 5n })
    expect(stdout).toEqual([])
  })

  it('prints one JSON object with bigints as strings under --json', () => {
    setJsonMode(true)
    const human = vi.fn()
    output({ sold: 1500000n, bought: null }, human)
    expect(human).not.toHaveBeenCalled()
    expect(JSON.parse(stdout.join('\n'))).toEqual({ sold: '1500000', bought: null })
  })
})

describe('table', () => {
  it('sizes every column to its widest cell, header included', () => {
    table(['TOKEN', 'PRIVATE'], [['ETH', '0.0004'], ['USDCx', '12.5']])
    const [header, rule, first] = stdout.slice(1)
    // A column narrower than its own header would let the header spill into the
    // next one and silently misalign the whole table.
    expect(header).toContain('TOKEN')
    expect(rule).toMatch(/─+/)
    expect(first!.indexOf('0.0004') + '0.0004'.length).toBe(header!.length)
  })

  it('pads short rows instead of throwing', () => {
    expect(() => table(['A', 'B', 'C'], [['only-one']])).not.toThrow()
  })
})

describe('run', () => {
  it('reports a failure as a line and sets a non-zero exit code', async () => {
    const previous = process.exitCode
    await run(async () => {
      throw new Error('holding less than this swap sells')
    })
    expect(process.exitCode).toBe(1)
    expect(stderr.join('\n')).toContain('holding less than this swap sells')
    process.exitCode = previous
  })

  it('prints the cause the SDK chained, rather than replacing it', async () => {
    const previous = process.exitCode
    await run(async () => {
      throw new Error('could not read the pool', { cause: new Error('502 from the node') })
    })
    expect(stderr.join('\n')).toContain('caused by: 502 from the node')
    process.exitCode = previous
  })

  it('reports the failure as an object under --json', async () => {
    const previous = process.exitCode
    setJsonMode(true)
    await run(async () => {
      throw new Error('no route at this size')
    })
    expect(stderr).toEqual([])
    expect(JSON.parse(stdout.join('\n')).error.message).toBe('no route at this size')
    process.exitCode = previous
  })
})
