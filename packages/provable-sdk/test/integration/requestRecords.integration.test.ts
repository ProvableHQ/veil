import { describe, it, expect, beforeAll } from 'vitest'
import { loadNetwork, registerProvableApi, createProvableSession } from '@provablehq/veil-aleo-sdk'

/**
 * Scans the VEIL_E2E account's credits.aleo records on testnet AND mainnet
 * through one wallet client: switchChain re-targets the proving stack, the
 * transport, and the attached record scanner together, so the second scan
 * hits mainnet without rebuilding the client. Registration with the Provable
 * API is required — see "Registering with the Provable API" in AGENTS.md.
 *
 * Credentials resolve in two steps: the pre-registered consumer from
 * ALEO_DPS_API_KEY + ALEO_CONSUMER_ID is preferred (verified with a JWT
 * mint); when absent or rejected, the test self-registers a throwaway
 * consumer via POST /consumers.
 *
 * Gated behind VEIL_INTEGRATION=1 and VEIL_E2E_PRIVATE_KEY. Hits the real
 * scanner service on both networks; read-only, no funds move.
 *
 * Run with:
 *   VEIL_INTEGRATION=1 npx vitest run packages/provable-sdk/test/integration/requestRecords.integration.test.ts
 */

const PRIVATE_KEY = process.env.VEIL_E2E_PRIVATE_KEY
const RUN = process.env.VEIL_INTEGRATION === '1' && !!PRIVATE_KEY

const NETWORK_URL = process.env.VEIL_API_URL ?? 'https://api.provable.com/v2'
const SCANNER_URL = process.env.VEIL_SCANNER_URL ?? 'https://api.provable.com/scanner'
const AUTH_URL = process.env.VEIL_AUTH_URL ?? 'https://api.provable.com'

/** Mints a JWT to prove the consumer credentials are valid. */
async function credentialsWork(consumerId: string, apiKey: string): Promise<boolean> {
  try {
    await createProvableSession({ credentials: { consumerId, apiKey }, baseUrl: AUTH_URL }).getJwt()
    return true
  } catch {
    return false
  }
}

/** Registers a throwaway consumer and returns its id and API key. */
async function selfRegister(): Promise<{ consumerId: string; apiKey: string }> {
  return registerProvableApi({
    username: `veil-records-it-${Math.floor(Date.now() / 1000)}`,
    baseUrl: AUTH_URL,
  })
}

/** Pre-registered env credentials when they verify; a fresh consumer otherwise. */
async function resolveCredentials(): Promise<{ consumerId: string; apiKey: string }> {
  const envId = process.env.ALEO_CONSUMER_ID
  const envKey = process.env.ALEO_DPS_API_KEY
  if (envId && envKey && (await credentialsWork(envId, envKey))) {
    return { consumerId: envId, apiKey: envKey }
  }
  return selfRegister()
}

describe.runIf(RUN)('requestRecords on testnet and mainnet with switchChain', () => {
  let consumerId: string
  let apiKey: string

  beforeAll(async () => {
    ;({ consumerId, apiKey } = await resolveCredentials())
  }, 60_000)

  it(
    'scans testnet records, switches the client to mainnet, scans mainnet records',
    async () => {
      // --- Testnet: full wallet-client path with an attached remote scanner ---
      const aleoTestnet = await loadNetwork('testnet')
      const scanner = aleoTestnet.createRemoteScanner({
        url: SCANNER_URL,
        consumerId,
        apiKey,
      })
      const { walletClient } = aleoTestnet.createAleoClient({
        privateKey: PRIVATE_KEY!,
        networkUrl: NETWORK_URL,
        provingMode: 'local',
        records: scanner,
      })

      const testnetRecords = await walletClient.requestRecords({ program: 'credits.aleo' })
      expect(testnetRecords.length).toBeGreaterThan(0)
      for (const record of testnetRecords) {
        expect(record.programName).toBe('credits.aleo')
        // requestRecords defaults to includePlaintext: true — every record
        // must carry decrypted plaintext.
        expect('recordPlaintext' in record && record.recordPlaintext).toContain('microcredits')
      }

      // --- Switch the whole client to mainnet: proving stack, transport
      // routing, and the record provider all re-target together ---
      await walletClient.switchChain({ network: 'mainnet' })

      // --- Mainnet: same wallet client, same view key, new chain ---
      const mainnetRecords = await walletClient.requestRecords({ program: 'credits.aleo' })
      expect(mainnetRecords.length).toBeGreaterThan(0)
      for (const record of mainnetRecords) {
        expect(record.programName).toBe('credits.aleo')
        expect('recordPlaintext' in record && record.recordPlaintext).toContain('microcredits')
      }
    },
    300_000,
  )
})

/**
 * Proves the RecordFilter bounds reach the Record Scanning Service and are
 * applied there — not locally.
 *
 * A local account pushes the filter to the service and Veil applies nothing on
 * top (only the RPC/wallet path filters client-side), so every assertion here is
 * a statement about the wire contract. That distinction is what makes these
 * tests worth running: the unit tests pin the request body Veil *builds*, and
 * only a live scan shows the service *honors* it. A casing slip such as
 * `resultsPerPage` for `results_per_page` is silently ignored by the service, so
 * it passes every unit test and fails only here.
 *
 * Read-only on testnet; no funds move.
 *
 * Run with:
 *   VEIL_INTEGRATION=1 npx vitest run packages/provable-sdk/test/integration/requestRecords.integration.test.ts
 */
describe.runIf(RUN)('RecordFilter bounds applied by the scanner service', () => {
  let scan: (params: Record<string, unknown>) => Promise<any[]>
  let baseline: any[]

  beforeAll(async () => {
    const { consumerId, apiKey } = await resolveCredentials()
    const aleo = await loadNetwork('testnet')
    const scanner = aleo.createRemoteScanner({ url: SCANNER_URL, consumerId, apiKey })
    const { walletClient } = aleo.createAleoClient({
      privateKey: PRIVATE_KEY!,
      networkUrl: NETWORK_URL,
      provingMode: 'local',
      records: scanner,
    })
    scan = (params) => walletClient.requestRecords(params as any) as Promise<any[]>
    baseline = await scan({ program: 'credits.aleo', statusFilter: 'unspent' })
    expect(baseline.length).toBeGreaterThan(0)
  }, 300_000)

  it('caps a page at results_per_page', async () => {
    // Decisive for the snake_case wire contract: the local path applies nothing
    // client-side, so a single record back means the service parsed the field.
    // Had Veil sent camelCase, the service would ignore it and return them all.
    const page = await scan({
      program: 'credits.aleo',
      statusFilter: 'unspent',
      filter: { resultsPerPage: 1 },
    })
    expect(page).toHaveLength(1)
  }, 120_000)

  it('walks disjoint pages of one record each', async () => {
    const [first, second] = await Promise.all([
      scan({ program: 'credits.aleo', statusFilter: 'unspent', filter: { resultsPerPage: 1, page: 0 } }),
      scan({ program: 'credits.aleo', statusFilter: 'unspent', filter: { resultsPerPage: 1, page: 1 } }),
    ])
    expect(first).toHaveLength(1)
    // Only meaningful with at least two records to page across.
    if (baseline.length > 1) {
      expect(second).toHaveLength(1)
      expect(second[0].commitment).not.toBe(first[0].commitment)
    }
  }, 120_000)

  it('narrows by record name, and an unknown name returns nothing', async () => {
    const credits = await scan({
      program: 'credits.aleo',
      statusFilter: 'unspent',
      filter: { records: ['credits'] },
    })
    expect(credits.length).toBe(baseline.length)

    const none = await scan({
      program: 'credits.aleo',
      statusFilter: 'unspent',
      filter: { records: ['definitely_not_a_record_type'] },
    })
    expect(none).toHaveLength(0)
  }, 120_000)

  it('narrows by commitment', async () => {
    const target = baseline.find((r) => r.commitment)
    expect(target, 'scanner returned no commitment to filter on').toBeDefined()
    const matched = await scan({
      program: 'credits.aleo',
      statusFilter: 'unspent',
      filter: { commitments: [target.commitment] },
    })
    expect(matched).toHaveLength(1)
    expect(matched[0].commitment).toBe(target.commitment)
  }, 120_000)

  it('narrows by block range and excludes everything below it', async () => {
    const heights = baseline.map((r) => r.blockHeight).filter((h) => typeof h === 'number')
    expect(heights.length, 'scanner returned no block heights to bound on').toBeGreaterThan(0)
    const max = Math.max(...heights)

    const withinRange = await scan({
      program: 'credits.aleo',
      statusFilter: 'unspent',
      filter: { start: 0, end: max },
    })
    expect(withinRange.length).toBe(baseline.length)

    // A window past the newest record must come back empty.
    const empty = await scan({
      program: 'credits.aleo',
      statusFilter: 'unspent',
      filter: { start: max + 1_000_000 },
    })
    expect(empty).toHaveLength(0)
  }, 120_000)

  it("returns at least the unspent set for statusFilter 'all'", async () => {
    // Regression for the 'all' defect: 'all' used to send unspent: true, which
    // the service reads as spent = false, so it returned the unspent set only.
    // Omitting the key must return a superset.
    const all = await scan({ program: 'credits.aleo', statusFilter: 'all' })
    expect(all.length).toBeGreaterThanOrEqual(baseline.length)

    const unspentCommitments = new Set(baseline.map((r) => r.commitment))
    const allCommitments = new Set(all.map((r) => r.commitment))
    for (const commitment of unspentCommitments) {
      expect(allCommitments.has(commitment)).toBe(true)
    }
  }, 120_000)

  it('scans every program when program is omitted', async () => {
    const everything = await scan({ statusFilter: 'unspent' })
    expect(everything.length).toBeGreaterThanOrEqual(baseline.length)
    // credits.aleo records must still be in there.
    expect(everything.some((r) => r.programName === 'credits.aleo')).toBe(true)
  }, 120_000)
})
