import { describe, it, expect } from 'vitest'
import { COMMANDS, usage } from '../src/registry.js'

/**
 * The registry is the only place a subcommand is declared, so these assertions
 * stand in for running the binary: a command that is listed but unloadable, or
 * loadable but missing `main`, fails here rather than in a user's terminal.
 */

describe('command registry', () => {
  it('every listed command loads a module exporting main(argv)', async () => {
    for (const [name, command] of Object.entries(COMMANDS)) {
      const module = await command.load()
      expect(typeof module.main, `${name} must export main`).toBe('function')
      // One parameter, and it is the argv the dispatcher passes down. A command
      // that read process.argv instead would see the subcommand as a positional.
      expect(module.main.length, `${name}.main must take argv`).toBe(1)
    }
  })

  it('every command has a summary for the top-level listing', () => {
    for (const [name, command] of Object.entries(COMMANDS)) {
      expect(command.summary.length, `${name} needs a summary`).toBeGreaterThan(0)
      expect(command.summary.trim(), `${name} summary must not be padded`).toBe(command.summary)
    }
  })

  it('lists every command in the usage block, aligned in a column', () => {
    const block = usage()
    for (const name of Object.keys(COMMANDS)) expect(block).toContain(name)

    // The summaries share a start column, which is what makes the list readable.
    const starts = Object.entries(COMMANDS).map(([name, { summary }]) => {
      const line = block.split('\n').find((candidate) => candidate.trimStart().startsWith(`${name} `))
      return line!.indexOf(summary)
    })
    expect(new Set(starts).size).toBe(1)
  })

  it('names the two rules that hold across every command', () => {
    // Both are enforced in shared.ts; the usage block is where a caller learns
    // they exist at all.
    expect(usage()).toContain('--execute')
    expect(usage()).toContain('mainnet is never implicit')
  })
})
