import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const EXAMPLE_DIRECTORY = join(REPOSITORY_ROOT, 'examples/bridge')
const LEGACY_OR_LOW_LEVEL_APIS = [
  'buildAleoHyperlaneTransferRemoteCall',
  'createSolanaRpcClient',
  'extractSolanaHyperlaneMessageId',
  'prepareTransfer',
  'quoteTransfer',
  'executeTransfer',
  'solanaExecutorFromKeyPair',
  'solanaExecutorFromWalletAccount',
]
const EXAMPLE_CONFIGURATION_HELPERS = [
  'booleanFromEnvironment',
  'millisecondsFromEnvironment',
]
const ROUTE_SPECIFIC_AMOUNT_OR_EXECUTION_ENVIRONMENT_VARIABLES = [
  'ETH_AMOUNT',
  'SOL_AMOUNT',
  'WBTC_AMOUNT',
  'USDC_AMOUNT',
  'USDCX_AMOUNT',
  'EXECUTE_HYPERLANE_ETH',
  'EXECUTE_HYPERLANE_WBTC',
  'EXECUTE_HYPERLANE_SOL',
  'EXECUTE_XRESERVE_DEPOSIT',
  'EXECUTE_XRESERVE_BURN',
]

describe('bridge examples', () => {
  it('use the current bridge lifecycle instead of legacy or protocol-internal utilities', () => {
    const files = [
      ...readdirSync(EXAMPLE_DIRECTORY)
        .filter((name) => name.endsWith('.ts'))
        .map((name) => join(EXAMPLE_DIRECTORY, name)),
      join(REPOSITORY_ROOT, 'packages/bridge/scripts/solana-deposit.ts'),
    ]

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const identifier of LEGACY_OR_LOW_LEVEL_APIS) {
        expect(source, `${file} still uses ${identifier}`).not.toContain(identifier)
      }
    }
  })

  it('keeps every lifecycle implementation on the structured prepare API', () => {
    const implementations = [
      'aleo-hyperlane.ts',
      'ethereum-hyperlane.ts',
      'sol-to-aleo.ts',
      'usdc-to-usdcx.ts',
      'usdcx-to-usdc.ts',
    ]

    for (const name of implementations) {
      const source = readFileSync(join(EXAMPLE_DIRECTORY, name), 'utf8')
      expect(source, `${name} must prepare a structured route`).toContain('bridge.prepare({')
    }
  })

  it('uses visible defaults instead of parsing optional example configuration', () => {
    const files = readdirSync(EXAMPLE_DIRECTORY)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => join(EXAMPLE_DIRECTORY, name))
    const sources = [
      ...files.map((file) => readFileSync(file, 'utf8')),
      readFileSync(join(EXAMPLE_DIRECTORY, 'README.md'), 'utf8'),
    ].join('\n')

    for (const identifier of [
      ...EXAMPLE_CONFIGURATION_HELPERS,
      ...ROUTE_SPECIFIC_AMOUNT_OR_EXECUTION_ENVIRONMENT_VARIABLES,
    ]) {
      expect(sources, `bridge examples still configure ${identifier}`).not.toContain(identifier)
    }
    expect(sources).toContain('EXECUTE_BRIDGE')
  })
})
