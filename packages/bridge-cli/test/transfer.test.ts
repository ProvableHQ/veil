import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { main } from '../src/commands/transfer.js'
import { runUsdcxToUsdcExample } from '../../bridge/examples/usdcx-to-usdc.js'
import { aleoExampleOptions, serviceAuth } from '../../bridge/examples/options.js'

const initialEnvironment = { ...process.env }
const recipient = '0x0000000000000000000000000000000000000001'

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'table').mockImplementation(() => {})
  for (const name of ['ALEO_PRIVATE_KEY', 'ALEO_CONSUMER_ID', 'ALEO_DPS_API_KEY', 'EDGE_PROVABLE_API_KEY', 'ALEO_PROVING_MODE']) delete process.env[name]
})
afterEach(() => {
  process.env = { ...initialEnvironment }
  vi.restoreAllMocks()
})

describe('CLI preview boundary', () => {
  it('previews the requested withdrawal amount despite inherited execution acknowledgement', async () => {
    process.env.EXECUTE_BRIDGE = 'I_UNDERSTAND_THIS_MOVES_REAL_FUNDS'
    await main(['--route', 'usdcx-to-usdc', '--amount', '7', '--recipient', recipient])
    expect(console.table).toHaveBeenCalledWith(expect.objectContaining({ amount: '7 USDCx' }))
    expect(console.log).toHaveBeenCalledWith('\nPreflight complete; no USDCx was burned.')
  })

  it('honors explicit false when an example is invoked directly', async () => {
    process.env.EXECUTE_BRIDGE = 'I_UNDERSTAND_THIS_MOVES_REAL_FUNDS'
    process.env.ETHEREUM_RECIPIENT = recipient
    await runUsdcxToUsdcExample({ amount: '3', execute: false })
    expect(console.table).toHaveBeenCalledWith(expect.objectContaining({ amount: '3 USDCx' }))
  })

  it('gives an explicit API-key file precedence over an inherited edge key', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'bridge-cli-test-'))
    try {
      const keyFile = join(directory, 'api.key')
      writeFileSync(keyFile, 'explicit-test-key\n')
      process.env.EDGE_PROVABLE_API_KEY = 'inherited-test-key'
      await main(['--route', 'usdcx-to-usdc', '--amount', '3', '--recipient', recipient, '--api-key-file', keyFile])
      expect(serviceAuth()).toEqual({ auth: { mode: 'api-key', value: 'explicit-test-key' } })
    } finally {
      rmSync(directory, { recursive: true })
    }
  })

  it('requires explicit execute to enter the signing path', async () => {
    await expect(main(['--route', 'usdcx-to-usdc', '--amount', '3', '--recipient', recipient, '--execute']))
      .rejects.toThrow('ALEO_PRIVATE_KEY is required')
  })

  it('rejects invalid proving modes before starting a transfer', async () => {
    await expect(main(['--route', 'usdcx-to-usdc', '--amount', '3', '--recipient', recipient, '--proving-mode', 'typo']))
      .rejects.toThrow('proving-mode must be delegated or local')
  })
})

describe('gateway configuration', () => {
  it('uses credential-free delegated proving by default', () => {
    expect(serviceAuth()).toEqual({})
    expect(aleoExampleOptions()).toMatchObject({ provingMode: 'delegated' })
  })
  it('passes a provisioned edge key as explicit API-key authentication', () => {
    process.env.EDGE_PROVABLE_API_KEY = 'test-key'
    process.env.ALEO_PROVING_MODE = 'local'
    expect(aleoExampleOptions()).toMatchObject({ provingMode: 'local', auth: { mode: 'api-key', value: 'test-key' } })
  })
  it('preserves explicitly supplied legacy credentials', () => {
    process.env.ALEO_CONSUMER_ID = 'consumer'
    process.env.ALEO_DPS_API_KEY = 'legacy-key'
    expect(serviceAuth()).toEqual({ consumerId: 'consumer', apiKey: 'legacy-key' })
  })
})
