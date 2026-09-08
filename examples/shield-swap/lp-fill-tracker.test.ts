import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('./lp-fill-tracker.ts', import.meta.url))
const runScript = (args: string[], env: Record<string, string> = {}) =>
  spawnSync('pnpm', ['exec', 'tsx', script, ...args], { encoding: 'utf8', env: { ...process.env, ...env } })

describe('lp-fill-tracker script', () => {
  it('explains how to supply the required position token id', () => {
    const result = runScript([])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'Usage: pnpm exec tsx examples/shield-swap/lp-fill-tracker.ts <position-token-id> [--network mainnet|testnet] [--history N]',
    )
  })

  it('requires a wallet key without asking for Provable API credentials', () => {
    const result = runScript(['11field'], {
      VEIL_E2E_PRIVATE_KEY: '',
      ALEO_CONSUMER_ID: '',
      ALEO_DPS_API_KEY: '',
      VEIL_POSITION_TOKEN_ID: '',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('VEIL_E2E_PRIVATE_KEY is required')
    expect(result.stderr).not.toContain('Provable API credentials')
  })

  it('rejects an unsupported network before starting the tracker', () => {
    const result = runScript(['11field', '--network', 'devnet'], { VEIL_E2E_PRIVATE_KEY: '' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Network must be mainnet or testnet')
    expect(result.stderr).not.toContain('VEIL_E2E_PRIVATE_KEY is required')
  })

  it('rejects a history that is not a non-negative integer', () => {
    const result = runScript(['11field', '--history', '-1'], { VEIL_E2E_PRIVATE_KEY: '' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('History must be a non-negative integer')
    expect(result.stderr).not.toContain('VEIL_E2E_PRIVATE_KEY is required')
  })
})
