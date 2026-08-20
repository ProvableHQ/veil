import { describe, it, expect, beforeAll } from 'vitest'
import { loadNetwork, type AleoSdk, type ProvableKeyedAuth } from '../../src/index.js'

/**
 * Live integration against the edge Provable API gateway using provisioned-key
 * auth. Every request — chain reads, delegated proving, and record scanning —
 * goes through `edge.provable.com` and authenticates with one `X-API-Key`
 * header. Nothing registers and nothing mints; a rejected key fails, it does
 * not retry.
 *
 * The scan test is read-only. The proof test SPENDS: it self-transfers one
 * microcredit via `credits.aleo/transfer_public` with the fee master paying
 * the base fee, so the account needs a public credits balance.
 *
 * Gated behind VEIL_INTEGRATION=1 and EDGE_API_KEY. The account defaults to
 * the SDK demo account (funded on testnet, public balance); override with
 * VEIL_E2E_PRIVATE_KEY.
 *
 * Run with:
 *   VEIL_INTEGRATION=1 EDGE_API_KEY=<key> npx vitest run packages/provable-sdk/test/integration/edgeKeyedAuth.integration.test.ts
 */

const EDGE_BASE = process.env.EDGE_BASE_URL ?? 'https://edge.provable.com/api'
const EDGE_API_KEY = process.env.EDGE_API_KEY

// SDK demo account — funded on testnet with a public credits balance.
const DEMO_PRIVATE_KEY = 'APrivateKey1zkp6aEqdUdRpZs1fnfGBEitWZNzxNhPz4kb2W382nuX8G42'
const PRIVATE_KEY = process.env.VEIL_E2E_PRIVATE_KEY ?? DEMO_PRIVATE_KEY

const RUN = process.env.VEIL_INTEGRATION === '1' && !!EDGE_API_KEY

describe.runIf(RUN)('edge gateway keyed auth (live)', () => {
  let aleo: AleoSdk
  let auth: ProvableKeyedAuth

  beforeAll(async () => {
    aleo = await loadNetwork('testnet')
    auth = { mode: 'api-key', value: EDGE_API_KEY! }
  }, 60_000)

  it('scans records through the edge scanner', async () => {
    const scanner = aleo.createRemoteScanner({ url: `${EDGE_BASE}/scanner`, auth })
    const { walletClient } = aleo.createAleoClient({
      privateKey: PRIVATE_KEY,
      networkUrl: `${EDGE_BASE}/v2`,
      proverUrl: `${EDGE_BASE}/prove`,
      auth,
      records: scanner,
    })
    const records = await walletClient.requestRecords({ program: 'credits.aleo' })
    expect(Array.isArray(records)).toBe(true)
  }, 300_000)

  it('proves through the edge prover and confirms on chain (spends one microcredit)', async () => {
    const account = aleo.privateKeyToAccount(PRIVATE_KEY)
    const config = aleo.createProvingConfig({
      mode: 'delegated',
      networkUrl: `${EDGE_BASE}/v2`,
      proverUrl: `${EDGE_BASE}/prove`,
      auth,
      account,
    })

    const result = await config.execute!({
      programName: 'credits.aleo',
      functionName: 'transfer_public',
      inputs: [account.address, '1u64'],
      fee: 0n,
    })

    expect(result.transactionId).toMatch(/^at1/)
    expect(result.outputs).toBeDefined()
  }, 300_000)
})
