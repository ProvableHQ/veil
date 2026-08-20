import { describe, it, expect, beforeAll } from 'vitest'
import { loadNetwork, type AleoSdk, type ProvableKeyedAuth } from '../../src/index.js'

/**
 * Live matrix over both Provable API auth paths: the JWT session model on
 * `api.provable.com` (a consumerId + apiKey pair minting short-lived tokens)
 * and the provisioned-key model on `edge.provable.com` (one `X-API-Key`
 * header per request). Each configured path runs the same two probes —
 * an authenticated record scan and a delegated proof with on-chain
 * confirmation — so a regression in either model, or a drift between them,
 * fails the same file.
 *
 * The scan is read-only. The proof SPENDS: one microcredit self-transferred
 * via `credits.aleo/transfer_public` per path, with the fee master paying the
 * base fee, so the account needs a public credits balance.
 *
 * Gated behind VEIL_INTEGRATION=1, then per path:
 * - jwt: ALEO_DPS_API_KEY + ALEO_CONSUMER_ID
 * - api-key: EDGE_PROVABLE_API_KEY
 * The account defaults to the SDK demo account (funded on testnet, public
 * balance); override with VEIL_E2E_PRIVATE_KEY.
 *
 * Run with:
 *   VEIL_INTEGRATION=1 EDGE_PROVABLE_API_KEY=<key> ALEO_DPS_API_KEY=<key> ALEO_CONSUMER_ID=<id> \
 *     npx vitest run packages/provable-sdk/test/integration/authPaths.integration.test.ts
 */

// SDK demo account — funded on testnet with a public credits balance.
const DEMO_PRIVATE_KEY = 'APrivateKey1zkp6aEqdUdRpZs1fnfGBEitWZNzxNhPz4kb2W382nuX8G42'
const PRIVATE_KEY = process.env.VEIL_E2E_PRIVATE_KEY ?? DEMO_PRIVATE_KEY

const EDGE_BASE = process.env.EDGE_BASE_URL ?? 'https://edge.provable.com/api'
const API_BASE = process.env.VEIL_AUTH_URL ?? 'https://api.provable.com'

type ClientAuthOptions = {
  auth?: ProvableKeyedAuth
  apiKey?: string
  consumerId?: string
}

type AuthPath = {
  name: string
  enabled: boolean
  networkUrl: string
  proverUrl: string
  scannerUrl: string
  clientAuth: ClientAuthOptions
}

const PATHS: AuthPath[] = [
  {
    name: 'jwt session on api.provable.com',
    enabled: !!(process.env.ALEO_DPS_API_KEY && process.env.ALEO_CONSUMER_ID),
    networkUrl: `${API_BASE}/v2`,
    proverUrl: `${API_BASE}/prove`,
    scannerUrl: `${API_BASE}/scanner`,
    clientAuth: {
      apiKey: process.env.ALEO_DPS_API_KEY,
      consumerId: process.env.ALEO_CONSUMER_ID,
    },
  },
  {
    name: 'provisioned key on edge.provable.com',
    enabled: !!process.env.EDGE_PROVABLE_API_KEY,
    networkUrl: `${EDGE_BASE}/v2`,
    proverUrl: `${EDGE_BASE}/prove`,
    scannerUrl: `${EDGE_BASE}/scanner`,
    clientAuth: { auth: { mode: 'api-key', value: process.env.EDGE_PROVABLE_API_KEY ?? '' } },
  },
]

const RUN = process.env.VEIL_INTEGRATION === '1' && PATHS.some((path) => path.enabled)

describe.runIf(RUN)('auth paths (live)', () => {
  let aleo: AleoSdk

  beforeAll(async () => {
    aleo = await loadNetwork('testnet')
  }, 60_000)

  for (const path of PATHS) {
    describe.runIf(path.enabled)(path.name, () => {
      it('scans records through the scanner', async () => {
        const scanner = aleo.createRemoteScanner({ url: path.scannerUrl, ...path.clientAuth })
        const { walletClient } = aleo.createAleoClient({
          privateKey: PRIVATE_KEY,
          networkUrl: path.networkUrl,
          proverUrl: path.proverUrl,
          ...path.clientAuth,
          records: scanner,
        })
        const records = await walletClient.requestRecords({ program: 'credits.aleo' })
        expect(Array.isArray(records)).toBe(true)
      }, 300_000)

      it('proves through the prover and confirms on chain (spends one microcredit)', async () => {
        const account = aleo.privateKeyToAccount(PRIVATE_KEY)
        const config = aleo.createProvingConfig({
          mode: 'delegated',
          networkUrl: path.networkUrl,
          proverUrl: path.proverUrl,
          ...path.clientAuth,
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
  }
})
