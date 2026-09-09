import { describe, expect, it } from 'vitest'
import { COMMANDS, usage } from '../src/registry.js'
import { CLI_ROUTES } from '../src/routes.js'

describe('command registry', () => {
  it('loads every listed command', async () => {
    for (const [name, command] of Object.entries(COMMANDS)) {
      const module = await command.load()
      expect(typeof module.main, `${name} must export main`).toBe('function')
      expect(module.main.length, `${name}.main must take argv`).toBe(1)
    }
  })

  it('includes every command in top-level help', () => {
    for (const name of Object.keys(COMMANDS)) expect(usage()).toContain(name)
    expect(usage()).toContain('--execute')
  })
})

describe('bridge route aliases', () => {
  it('covers every journey demonstrated by the bridge examples', () => {
    expect(CLI_ROUTES.map(({ name }) => name)).toEqual([
      'arc-to-aleo',
      'usdc-to-usdcx',
      'usdcx-to-usdc',
      'eth-to-aleo',
      'wbtc-to-aleo',
      'eth-to-ethereum',
      'wbtc-to-ethereum',
      'sol-to-aleo',
      'sol-to-solana',
    ])
  })

  it('has unique aliases and route IDs', () => {
    expect(new Set(CLI_ROUTES.map(({ name }) => name)).size).toBe(CLI_ROUTES.length)
    expect(new Set(CLI_ROUTES.map(({ routeId }) => routeId)).size).toBe(CLI_ROUTES.length)
  })
})
