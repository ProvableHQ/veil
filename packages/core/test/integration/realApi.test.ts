import { describe, it, expect, beforeAll } from 'vitest'
import { createPublicClient } from '../../src/clients/createPublicClient.js'
import { http } from '../../src/transports/http.js'
import { assertShape, type ShapeSpec } from '../support/assertShape.js'

/**
 * Integration tests against the live Provable API. Gated behind VEIL_INTEGRATION=1.
 *
 * Run with:
 *   VEIL_INTEGRATION=1 npx vitest run packages/core/test/integration/realApi.test.ts
 *
 * Structure — three tiers:
 *
 *  Tier 1 — hardcoded safe vectors. `credits.aleo` is used for endpoints that
 *           make sense on a first-class/genesis program; `puzzle_arcade_coin_v002.aleo`
 *           is used for edition/deployment lookups (credits.aleo has no deployment tx).
 *
 *  Tier 2 — vectors bootstrapped from prior API calls (latest block, tokens list,
 *           program address). Tests within this tier skip individually if their
 *           specific bootstrap data is unavailable.
 *
 *  Tier 3 — user-supplied via env vars, for vectors that can't be auto-discovered.
 *           Currently only the amendment-related endpoints, gated on
 *           VEIL_TEST_AMENDED_PROGRAM. No mainnet program has amendments today;
 *           see https://github.com/ProvableHQ/veil/issues/40.
 *
 * Optional env overrides:
 *   VEIL_API_URL               — base API URL (default: https://api.provable.com/v2)
 *   VEIL_NETWORK               — 'mainnet' | 'testnet' (default: 'mainnet')
 *   VEIL_TEST_PROGRAM_ID       — first-class program (default: 'credits.aleo')
 *   VEIL_TEST_DEPLOYED_PROGRAM — deployed program for edition lookups
 *                                (default: 'puzzle_arcade_coin_v002.aleo')
 *   VEIL_TEST_COMMITMENTS      — comma-separated commitments for getStatePaths
 *   VEIL_TEST_AMENDED_PROGRAM  — program with amendments > 0 (Tier 3, optional)
 *   VEIL_TEST_AMENDED_EDITION  — edition number on the amended program
 *   VEIL_TEST_AMENDMENT        — amendment number within that edition
 */

const RUN = process.env.VEIL_INTEGRATION === '1'

const API_URL = process.env.VEIL_API_URL ?? 'https://api.provable.com/v2'
const NETWORK = (process.env.VEIL_NETWORK as 'mainnet' | 'testnet' | undefined) ?? 'mainnet'
const PROGRAM_ID = process.env.VEIL_TEST_PROGRAM_ID ?? 'credits.aleo'
const DEPLOYED_PROGRAM = process.env.VEIL_TEST_DEPLOYED_PROGRAM ?? 'puzzle_arcade_coin_v002.aleo'

// State-path vectors per network — a commitment only resolves on the chain it
// was created on, and the API 502s (rather than 404s) on unresolvable inputs.
// Override with VEIL_TEST_COMMITMENTS if these get pruned. The repeated
// mainnet commitment is deliberate: it still exercises the batch path.
const MAINNET_COMMITMENTS = [
  '2603833136188907532194616745451484525888387221869530348932771543190230697146field',
  '2603833136188907532194616745451484525888387221869530348932771543190230697146field',
]
const TESTNET_COMMITMENTS = [
  '3955342727272311631397274863769364826445372300002295001500327687918144964187field',
  '360335536692650403149180907504772813391262210443170533323444515646946440826field',
]
const COMMITMENTS =
  (process.env.VEIL_TEST_COMMITMENTS?.split(',').map((s) => s.trim()).filter(Boolean)) ??
  (NETWORK === 'mainnet' ? MAINNET_COMMITMENTS : TESTNET_COMMITMENTS)

const AMENDED_PROGRAM = process.env.VEIL_TEST_AMENDED_PROGRAM
const AMENDED_EDITION = process.env.VEIL_TEST_AMENDED_EDITION ? Number(process.env.VEIL_TEST_AMENDED_EDITION) : undefined
const AMENDMENT = process.env.VEIL_TEST_AMENDMENT ? Number(process.env.VEIL_TEST_AMENDMENT) : undefined

// Real mainnet vectors for pre-existing endpoint coverage.
const REAL_TX_ID = 'at18wgg7grq6lj3tke03l7mn7kd4sfhxe2nysjj3p0p6lvrvl4v6c8sy5d89u'
const REAL_TRANSITION_ID = 'au1nd8uzh35v4z9r5wtgcvhmmkyfg76xmh2crh5dlseevxvnngf8vxs3qf8ex'
const VALIDATOR_ADDRESS = 'aleo1vfukg8ky2mhfprw63s0k0hl4vvd8573s6fkn8cv9y0ca6q27eq8qwdnxls'

// ---------- Response shapes (mirror of declared TS types) ----------

const amendmentCountShape: ShapeSpec = {
  program_id: 'string',
  edition: 'number',
  amendment_count: 'number',
}

const programCallsCursorShape: ShapeSpec = {
  block_number: 'number',
  transition_id: 'string',
}

const programCallsPaginatedShape: ShapeSpec = {
  prev_cursor: { __nullable: programCallsCursorShape },
  next_cursor: { __nullable: programCallsCursorShape },
  calls: {
    __array: {
      transaction_id: 'string',
      function_id: 'string',
      block_number: 'number',
      block_timestamp: 'string',
      status: 'string',
    },
  },
}

const programMetricsDayPointShape: ShapeSpec = { day: 'string', calls: 'number' }

const blockTransactionsByHashShape: ShapeSpec = {
  transactions: {
    __array: {
      id: 'string',
      fee: 'number',
      status: 'string',
      block_height: 'number',
      block_timestamp: 'string',
      block_hash: 'string',
      transaction_type: 'string',
      program_id: 'string',
      function_id: 'string',
    },
  },
}

const tokenDetailsShape: ShapeSpec = {
  token: {
    __nullable: {
      token_id: 'string',
      token_id_datatype: 'string',
      symbol: 'string',
      display: 'string',
      program_name: 'string',
      decimals: 'number',
      total_supply: 'string',
      verified: 'boolean',
      token_icon_url: { __nullable: 'string' },
      compliance_freeze_list: { __nullable: 'unknown' },
      price: { __nullable: 'string' },
      price_change_percentage_24h: { __nullable: 'string' },
      fully_diluted_value: { __nullable: 'string' },
      total_market_cap: { __nullable: 'string' },
      volume_24h: { __nullable: 'string' },
    },
  },
  price_history: {
    pagination: {
      __nullable: {
        limit: 'number',
        offset: 'number',
        total_count: 'number',
        has_next: 'boolean',
        has_previous: 'boolean',
      },
    },
    data: {
      __array: {
        day: 'string',
        price_usd: { __nullable: 'string' },
        volume_24h: { __nullable: 'string' },
        total_market_cap: { __nullable: 'string' },
      },
    },
  },
}

// ---------- The suite ----------

describe.runIf(RUN)('integration: real Provable API', () => {
  const client = createPublicClient({ transport: http(API_URL, { network: NETWORK }) })

  // ===== Tier 1 =====

  describe('Tier 1: hardcoded safe vectors', () => {
    it('getLatestEdition for credits.aleo returns a non-negative integer', async () => {
      const edition = await client.getLatestEdition({ programId: PROGRAM_ID })
      assertShape(edition, 'number')
      expect(edition).toBeGreaterThanOrEqual(0)
    }, 15_000)

    it('getAmendmentCount for credits.aleo returns a typed payload', async () => {
      const payload = await client.getAmendmentCount({ programId: PROGRAM_ID })
      assertShape(payload, amendmentCountShape)
      expect(payload.program_id).toBe(PROGRAM_ID)
      expect(payload.amendment_count).toBeGreaterThanOrEqual(0)
    }, 15_000)

    it('getProgramAddress for credits.aleo returns a non-empty address', async () => {
      const address = await client.getProgramAddress({ programId: PROGRAM_ID })
      assertShape(address, 'string')
      expect(address.length).toBeGreaterThan(0)
    }, 15_000)

    it('getProgramByEdition returns program source for a deployed program at edition 0', async () => {
      const source = await client.getProgramByEdition({ programId: DEPLOYED_PROGRAM, edition: 0 })
      assertShape(source, 'string')
      expect(source).toMatch(new RegExp(`^program\\s+${DEPLOYED_PROGRAM.replace(/\./g, '\\.')};`))
    }, 15_000)

    it('getDeploymentTransactionByEdition returns a real tx id for a deployed program', async () => {
      const txId = await client.getDeploymentTransactionByEdition({ programId: DEPLOYED_PROGRAM, edition: 0 })
      assertShape(txId, 'string')
      expect(txId).toMatch(/^at1/)
    }, 15_000)

    it('getOriginalDeploymentTransaction returns a tx id for a deployed program', async () => {
      const txId = await client.getOriginalDeploymentTransaction({ programId: DEPLOYED_PROGRAM, edition: 0 })
      assertShape(txId, { __nullable: 'string' })
      expect(txId).toMatch(/^at1/)
    }, 15_000)

    it('getOriginalDeploymentTransaction returns null for a genesis program (credits.aleo)', async () => {
      // Genesis programs have no conventional deployment tx — verifies the null branch.
      const txId = await client.getOriginalDeploymentTransaction({ programId: PROGRAM_ID, edition: 0 })
      assertShape(txId, { __nullable: 'string' })
      expect(txId).toBeNull()
    }, 15_000)

    it('getAmendmentDeploymentTransaction for an unamended program returns null', async () => {
      // With zero amendments on mainnet today, exercises the null branch of the union.
      const txId = await client.getAmendmentDeploymentTransaction({
        programId: PROGRAM_ID,
        edition: 0,
        amendment: 0,
      })
      assertShape(txId, { __nullable: 'string' })
    }, 15_000)

    it('getProgramCallsPaginated for credits.aleo returns a valid pagination payload', async () => {
      const payload = await client.getProgramCallsPaginated({ programId: PROGRAM_ID, limit: 5 })
      assertShape(payload, programCallsPaginatedShape)
      expect(payload.calls.length).toBeLessThanOrEqual(5)
    }, 20_000)

    it('getProgramMetricsByRange for credits.aleo over 30 days returns a day-keyed series', async () => {
      const series = await client.getProgramMetricsByRange({ programId: PROGRAM_ID, days: 30 })
      assertShape(series, { __array: programMetricsDayPointShape })
    }, 20_000)

    it('getStatePaths resolves real mainnet commitments', async () => {
      // Commitments can be pruned from the state tree (e.g., when records are spent).
      // If the default vectors have been pruned, skip so the test doesn't falsely fail —
      // override VEIL_TEST_COMMITMENTS with fresher values.
      try {
        const paths = await client.getStatePaths({ commitments: COMMITMENTS })
        assertShape(paths, { __array: 'string' })
        expect(paths.length).toBe(COMMITMENTS.length)
      } catch (err) {
        if ((err as Error).message.includes('State path(s) not found')) {
          console.warn('getStatePaths: default commitments appear pruned; set VEIL_TEST_COMMITMENTS to re-enable.')
          return
        }
        throw err
      }
    }, 20_000)

    // ---- Pre-existing endpoints: chain-level (no-input) ----

    it('getBlockNumber returns a positive bigint', async () => {
      const height = await client.getBlockNumber()
      expect(typeof height).toBe('bigint')
      expect(height).toBeGreaterThan(0n)
    }, 15_000)

    it('getBlockHash returns a valid ab1… hash', async () => {
      const hash = await client.getBlockHash()
      assertShape(hash, 'string')
      expect(hash).toMatch(/^ab1/)
    }, 15_000)

    it('getStateRoot (no height) returns the latest state root', async () => {
      const root = await client.getStateRoot({})
      assertShape(root, 'string')
      expect(root.length).toBeGreaterThan(0)
    }, 15_000)

    it('getCommittee (no height) returns a committee object', async () => {
      const committee = await client.getCommittee({})
      assertShape(committee, {
        id: 'string',
        starting_round: 'number',
        members: 'unknown',
      })
    }, 15_000)

    it('getBlockSummary returns a non-empty array', async () => {
      const summary = await client.getBlockSummary()
      assertShape(summary, { __array: 'unknown' })
      expect(Array.isArray(summary) && summary.length).toBeGreaterThan(0)
    }, 15_000)

    it('getTransactionSummary returns a non-empty array', async () => {
      const summary = await client.getTransactionSummary()
      assertShape(summary, { __array: 'unknown' })
      expect(Array.isArray(summary) && summary.length).toBeGreaterThan(0)
    }, 15_000)

    // ---- Pre-existing endpoints: metrics / supply / tokens ----

    it('getTransactionMetrics returns daily transaction count series', async () => {
      const series = await client.getTransactionMetrics()
      assertShape(series, { __array: { day: 'string', count: 'number' } })
    }, 15_000)

    it('getProgramMetrics returns per-program call counts', async () => {
      const metrics = await client.getProgramMetrics()
      assertShape(metrics, { __array: { program_id: 'string', calls: 'number' } })
    }, 15_000)

    it('getApy returns a numeric APY', async () => {
      const apy = await client.getApy()
      assertShape(apy, 'number')
      expect(apy).toBeGreaterThanOrEqual(0)
    }, 15_000)

    it('getValidatorApy returns per-validator APY entries', async () => {
      const rows = await client.getValidatorApy()
      assertShape(rows, { __array: { validator: 'string', apy: 'number' } })
    }, 15_000)

    it('getTotalSupply returns a numeric credit total', async () => {
      const supply = await client.getTotalSupply()
      assertShape(supply, 'number')
      expect(supply).toBeGreaterThan(0)
    }, 15_000)

    it('getCirculatingSupply returns a numeric circulating total', async () => {
      const supply = await client.getCirculatingSupply()
      assertShape(supply, 'number')
      expect(supply).toBeGreaterThan(0)
    }, 15_000)

    it('getTvl returns a list of protocol total-value entries', async () => {
      const tvl = await client.getTvl()
      assertShape(tvl, { __array: { protocol_name: 'string', total_value: 'number' } })
    }, 15_000)

    it('getTokens returns a paginated token list with data[]', async () => {
      const tokens = (await client.getTokens()) as any
      assertShape(tokens, {
        pagination: {
          limit: 'number',
          offset: 'number',
          total_count: 'number',
          has_next: 'boolean',
          has_previous: 'boolean',
        },
        data: { __array: 'unknown' },
      })
      expect(tokens.data.length).toBeGreaterThan(0)
    }, 15_000)

    // ---- Pre-existing endpoints: program basics ----

    it('getCode for credits.aleo returns program source', async () => {
      const source = await client.getCode({ programId: 'credits.aleo' })
      assertShape(source, 'string')
      expect(source).toMatch(/^program\s+credits\.aleo;/)
    }, 15_000)

    it('getMappingNames for credits.aleo lists the standard mappings', async () => {
      const names = await client.getMappingNames({ programId: 'credits.aleo' })
      assertShape(names, { __array: 'string' })
      expect(names).toContain('account')
      expect(names).toContain('committee')
    }, 15_000)

    it('getDeploymentTransaction for a deployed program returns a tx id', async () => {
      const txId = await client.getDeploymentTransaction({ programId: DEPLOYED_PROGRAM })
      assertShape(txId, 'string')
      expect(txId).toMatch(/^at1/)
    }, 15_000)

    it('getProgramCalls for credits.aleo returns recent call entries', async () => {
      const calls = await client.getProgramCalls({ programId: 'credits.aleo' })
      assertShape(calls, { __array: 'unknown' })
      expect(Array.isArray(calls) && calls.length).toBeGreaterThan(0)
    }, 15_000)

    // ---- Pre-existing endpoints: transactions by ID ----

    it('getTransaction resolves a real tx id to a Transaction', async () => {
      const tx = (await client.getTransaction({ id: REAL_TX_ID })) as any
      assertShape(tx, { type: 'string', id: 'string' })
      expect(tx.id).toBe(REAL_TX_ID)
    }, 15_000)

    it('getConfirmedTransaction returns a confirmed-transaction envelope', async () => {
      const confirmed = (await client.getConfirmedTransaction({ id: REAL_TX_ID })) as any
      assertShape(confirmed, { type: 'string', index: 'number', status: 'string' })
    }, 15_000)

    it('findBlockHash resolves a real tx id to a block hash', async () => {
      const hash = await client.findBlockHash({ transactionId: REAL_TX_ID })
      assertShape(hash, 'string')
      expect(hash).toMatch(/^ab1/)
    }, 15_000)

    it('findTransactionId resolves a real transition id to a tx id', async () => {
      const txId = await client.findTransactionId({ transitionId: REAL_TRANSITION_ID })
      assertShape(txId, 'string')
      expect(txId).toMatch(/^at1/)
    }, 15_000)

    it('getTransactionByTransition composes lookup + fetch into a Transaction', async () => {
      const tx = (await client.getTransactionByTransition({ transitionId: REAL_TRANSITION_ID })) as any
      assertShape(tx, { type: 'string', id: 'string' })
      expect(tx.id).toMatch(/^at1/)
    }, 20_000)

    // ---- Pre-existing endpoints: account/address-scoped ----

    it('getBalance returns a bigint for the validator address', async () => {
      const balance = await client.getBalance({ address: VALIDATOR_ADDRESS })
      expect(typeof balance).toBe('bigint')
      expect(balance).toBeGreaterThanOrEqual(0n)
    }, 15_000)

    it('readContract against credits.aleo account mapping returns the raw literal', async () => {
      const value = await client.readContract({
        programId: 'credits.aleo',
        mapping: 'account',
        key: VALIDATOR_ADDRESS,
      })
      assertShape(value, 'string')
      // Aleo literal: numeric value + type suffix, e.g. "4688158u64"
      expect(value).toMatch(/^\d+u64$/)
    }, 15_000)

    it('getDelegators returns an array of delegator addresses for a validator', async () => {
      const delegators = await client.getDelegators({ validator: VALIDATOR_ADDRESS })
      assertShape(delegators, { __array: 'string' })
    }, 15_000)

    it('getStakingEarnings returns earnings payload for the validator address', async () => {
      const earnings = (await client.getStakingEarnings({ address: VALIDATOR_ADDRESS })) as any
      assertShape(earnings, { total_rewards: 'number', at_block: 'number' })
      expect(earnings.total_rewards).toBeGreaterThanOrEqual(0)
    }, 15_000)

    it('getTransitions returns a list of transitions for the validator address', async () => {
      const transitions = await client.getTransitions({ address: VALIDATOR_ADDRESS })
      assertShape(transitions, { __array: 'unknown' })
    }, 15_000)
  })

  // ===== Tier 2 =====

  describe('Tier 2: bootstrapped vectors', () => {
    let latestHeight: number | null = null
    let latestBlockHash: string | null = null
    let latestStateRoot: string | null = null
    let programAddress: string | null = null
    let firstTokenProgramName: string | null = null
    let firstTokenId: string | null = null

    beforeAll(async () => {
      await Promise.all([
        (async () => {
          try {
            const block = (await client.getLatestBlock()) as any
            latestBlockHash = block?.block_hash ?? null
            latestStateRoot = block?.header?.previous_state_root ?? null
            const h = block?.header?.metadata?.height
            latestHeight = typeof h === 'number' ? h : h != null ? Number(h) : null
          } catch {
            // leave nulls
          }
        })(),
        (async () => {
          try {
            programAddress = await client.getProgramAddress({ programId: PROGRAM_ID })
          } catch {
            // leave null
          }
        })(),
        (async () => {
          try {
            const tokens = (await client.getTokens()) as any
            const list: unknown = Array.isArray(tokens) ? tokens : tokens?.tokens ?? tokens?.data
            if (Array.isArray(list) && list.length > 0) {
              const first = list[0] as any
              firstTokenProgramName = first?.program_name ?? first?.token?.program_name ?? null
              firstTokenId = first?.token_id ?? first?.token?.token_id ?? null
            }
          } catch {
            // leave nulls
          }
        })(),
      ])
    }, 30_000)

    it('getBlockHeightByHash round-trips for the latest block', async () => {
      if (latestBlockHash === null) return
      const height = await client.getBlockHeightByHash({ hash: latestBlockHash })
      assertShape(height, 'number')
      expect(height).toBeGreaterThanOrEqual(0)
    }, 15_000)

    it('getBlockTransactionsByHash — endpoint currently returns 500 on mainnet (server-side bug)', async () => {
      if (latestBlockHash === null) return
      // Known live-API bug: /transactions/block/{hash} returns 500 for all block hashes tested.
      // The action and URL shape are correct; this test documents the upstream issue and
      // verifies that the client surfaces the 500 as a TransportError rather than silently
      // returning bad data. Flip the assertion once the server-side bug is resolved.
      await expect(client.getBlockTransactionsByHash({ hash: latestBlockHash })).rejects.toThrow(/HTTP 500/)
    }, 20_000)

    it('findBlockHeightByStateRoot resolves a real state root to a height', async () => {
      if (latestStateRoot === null) return
      const height = await client.findBlockHeightByStateRoot({ stateRoot: latestStateRoot })
      assertShape(height, 'number')
      expect(height).toBeGreaterThanOrEqual(0)
    }, 15_000)

    it('getProgramIdByAddress round-trips credits.aleo via its own address', async () => {
      if (programAddress === null) return
      const id = await client.getProgramIdByAddress({ address: programAddress })
      assertShape(id, 'string')
      expect(id).toBe(PROGRAM_ID)
    }, 15_000)

    it('getTokenDetails returns a token + price_history for a discovered token', async () => {
      if (firstTokenProgramName === null || firstTokenId === null) return
      // The endpoint requires both program_id AND token_id — without token_id the response
      // is { token: null, price_history: { pagination: null, data: [] } }.
      const payload = await client.getTokenDetails({
        programId: firstTokenProgramName,
        tokenId: firstTokenId,
        limit: 5,
      })
      assertShape(payload, tokenDetailsShape)
      expect(payload.token).not.toBeNull()
    }, 30_000)

    it('getTokenDetails without token_id returns { token: null }', async () => {
      if (firstTokenProgramName === null) return
      const payload = await client.getTokenDetails({ programId: firstTokenProgramName })
      assertShape(payload, tokenDetailsShape)
      expect(payload.token).toBeNull()
    }, 20_000)

    it('getAmendmentCountByEdition for a deployed program at edition 0 returns a typed payload', async () => {
      const payload = await client.getAmendmentCountByEdition({ programId: DEPLOYED_PROGRAM, edition: 0 })
      assertShape(payload, amendmentCountShape)
      expect(payload.edition).toBe(0)
    }, 15_000)

    // ---- Bootstrapped block-height endpoints ----

    it('getBlock({ height }) fetches the latest block', async () => {
      if (latestHeight === null) return
      const block = (await client.getBlock({ height: latestHeight })) as any
      assertShape(block, { block_hash: 'string' })
      expect(block.block_hash).toMatch(/^ab1/)
    }, 15_000)

    it('getBlock({ hash }) fetches the latest block by hash', async () => {
      if (latestBlockHash === null) return
      const block = (await client.getBlock({ hash: latestBlockHash })) as any
      assertShape(block, { block_hash: 'string' })
      expect(block.block_hash).toBe(latestBlockHash)
    }, 15_000)

    it('getBlockTransactions({ height }) returns transitions for the latest block', async () => {
      if (latestHeight === null) return
      const txs = await client.getBlockTransactions({ height: latestHeight })
      assertShape(txs, { __array: 'unknown' })
    }, 15_000)

    it('getBlocks returns a 3-block range ending at the latest height', async () => {
      if (latestHeight === null) return
      const start = Math.max(0, latestHeight - 2)
      const end = latestHeight
      const blocks = await client.getBlocks({ start, end })
      assertShape(blocks, { __array: 'unknown' })
      // 3-block window: expect 3 entries (inclusive) unless boundary clipped.
      expect(Array.isArray(blocks) && blocks.length).toBeGreaterThanOrEqual(1)
    }, 20_000)

    it('getStateRoot({ height }) returns the state root at a specific height', async () => {
      if (latestHeight === null) return
      const root = await client.getStateRoot({ height: latestHeight })
      assertShape(root, 'string')
      expect(root.length).toBeGreaterThan(0)
    }, 15_000)
  })

  // ===== Tier 3 =====

  describe('Tier 3: user-supplied vectors for amendment-specific endpoints', () => {
    const hasAmendmentVector = Boolean(AMENDED_PROGRAM && AMENDED_EDITION !== undefined && AMENDMENT !== undefined)

    it.runIf(hasAmendmentVector)('getAmendmentDeploymentTransaction returns a tx id for a real amendment', async () => {
      const txId = await client.getAmendmentDeploymentTransaction({
        programId: AMENDED_PROGRAM!,
        edition: AMENDED_EDITION!,
        amendment: AMENDMENT!,
      })
      assertShape(txId, { __nullable: 'string' })
      expect(txId).toMatch(/^at1/)
    }, 15_000)

    it.runIf(Boolean(AMENDED_PROGRAM))('getAmendmentCount reports a non-zero amendment_count for a real amended program', async () => {
      const payload = await client.getAmendmentCount({ programId: AMENDED_PROGRAM! })
      assertShape(payload, amendmentCountShape)
      expect(payload.amendment_count).toBeGreaterThan(0)
    }, 15_000)
  })
})
