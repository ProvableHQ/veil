import { describe, it, expect, beforeAll } from 'vitest'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

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
  const res = await fetch(`${AUTH_URL}/jwts/${consumerId}`, {
    method: 'POST',
    headers: { 'X-Provable-API-Key': apiKey },
  })
  return res.ok
}

/** Registers a throwaway consumer and returns its id and API key. */
async function selfRegister(): Promise<{ consumerId: string; apiKey: string }> {
  const res = await fetch(`${AUTH_URL}/consumers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `veil-records-it-${Math.floor(Date.now() / 1000)}` }),
  })
  if (!res.ok) throw new Error(`Consumer registration failed: HTTP ${res.status}`)
  const body = (await res.json()) as { consumer: { id: string }; key: string }
  return { consumerId: body.consumer.id, apiKey: body.key }
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
