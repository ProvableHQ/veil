import { describe, it, expect, beforeAll } from 'vitest'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { shieldSwapActions } from '../../src/decorators/shieldSwapActions.js'
import { getPrivateBalances } from '../../src/utils/records.js'
import { getBalances } from '../../src/utils/balances.js'

/**
 * Real-chain integration for the balance surface: getPublicBalances (wrapper
 * `balances` mappings), getPrivateBalances (records), and the composed
 * getBalances. Read-only — no transactions — but private balances need the
 * account's own records, so this shares the e2e tier's gating. The DEX API
 * is used only for the public token registry.
 *
 * Requirements (skipped when absent):
 *   VEIL_INTEGRATION=1
 *   VEIL_E2E_PRIVATE_KEY   the account whose balances we read
 *   ALEO_DPS_API_KEY, ALEO_CONSUMER_ID   authenticate + register the scanner
 */
const PRIVATE_KEY = process.env.VEIL_E2E_PRIVATE_KEY
const DPS_API_KEY = process.env.ALEO_DPS_API_KEY
const CONSUMER_ID = process.env.ALEO_CONSUMER_ID
const RUN = process.env.VEIL_INTEGRATION === '1' && !!PRIVATE_KEY && !!DPS_API_KEY && !!CONSUMER_ID

const NETWORK_URL = 'https://api.provable.com/v2'
const RSS_URL = process.env.ALEO_RSS_URL ?? 'https://api.provable.com/scanner'
const DEX_PROGRAM = process.env.VEIL_DEX_PROGRAM ?? 'shield_swap.aleo'

describe.runIf(RUN)('balances against the real chain + records', () => {
  let client: ReturnType<ReturnType<typeof shieldSwapActions>>
  let address: string

  beforeAll(async () => {
    const aleo = await loadNetwork('testnet')
    const scanner = aleo.createRemoteScanner({ url: RSS_URL, consumerId: CONSUMER_ID!, apiKey: DPS_API_KEY })
    const { walletClient, account } = aleo.createAleoClient({
      privateKey: PRIVATE_KEY!,
      networkUrl: NETWORK_URL,
      provingMode: 'delegated',
      apiKey: DPS_API_KEY,
      consumerId: CONSUMER_ID,
      records: scanner,
    })
    address = account.address
    client = walletClient.extend(shieldSwapActions({ api: {}, program: DEX_PROGRAM }))
  }, 60_000)

  /** AMM token programs from the registry — where public balances live. */
  async function ammTokenPrograms(): Promise<string[]> {
    const tokens = (await client.api.getTokens()).data
    return tokens.map((t) => t.amm_token_program).filter((p): p is string => !!p)
  }

  it('getPublicBalances reads a non-negative u128 per AMM token program', async () => {
    const programs = await ammTokenPrograms()
    expect(programs.length).toBeGreaterThan(0)
    const pub = await client.getPublicBalances({ user: address, programs })
    expect(Object.keys(pub).sort()).toEqual([...new Set(programs)].sort())
    for (const amount of Object.values(pub)) {
      expect(typeof amount).toBe('bigint')
      expect(amount >= 0n).toBe(true)
    }
  }, 60_000)

  it('getPrivateBalances sums records into non-negative bigints per program', async () => {
    const tokens = (await client.api.getTokens()).data
    const programs = tokens.map((t) => t.underlying_program).filter((p): p is string => !!p)
    const priv = await getPrivateBalances(client, { programs })
    for (const [key, amount] of Object.entries(priv)) {
      expect(typeof amount).toBe('bigint')
      expect(amount >= 0n).toBe(true)
      expect(programs.some((p) => key === p || key.startsWith(`${p}/`))).toBe(true)
    }
  }, 120_000)

  it('getBalances joins public + private with total === public + private per token', async () => {
    const tokens = (await client.api.getTokens()).data
    const balances = await getBalances(client, client.api, {})
    const pub = await client.getPublicBalances({ user: address, programs: await ammTokenPrograms() })
    const publicByToken = new Map(
      tokens.filter((t) => !!t.amm_token_program).map((t) => [t.address, pub[t.amm_token_program!] ?? 0n]),
    )

    for (const [tokenId, entry] of Object.entries(balances)) {
      expect(tokenId).toMatch(/field$/)
      expect(entry.total).toBe(entry.public + entry.private)
      expect(entry.public).toBe(publicByToken.get(tokenId) ?? 0n) // matches the direct chain read
      expect(entry.public >= 0n && entry.private >= 0n).toBe(true)
      expect(entry.symbol.length).toBeGreaterThan(0)
      // default (no token filter) omits tokens held in neither
      expect(entry.total > 0n).toBe(true)
    }
  }, 120_000)

  it('getBalances with an explicit token filter reports exactly that token (even at zero)', async () => {
    const tokenId = (await client.api.getTokens()).data[0]!.address
    const balances = await getBalances(client, client.api, { tokens: [tokenId] })
    expect(Object.keys(balances)).toEqual([tokenId])
    expect(balances[tokenId]!.total).toBe(balances[tokenId]!.public + balances[tokenId]!.private)
  }, 120_000)
})
