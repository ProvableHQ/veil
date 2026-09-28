import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { shieldSwapActions } from '../../src/decorators/shieldSwapActions.js'
import { fileBlindedIdentityStore } from '../../src/node.js'
import type { QuoteParameters } from '../../src/actions/swap/quote.js'

/**
 * Exercises the real API → quote → swap → chain receipt → claim lifecycle.
 * No network calls or transaction submission are mocked. Explicit opt-in:
 * VEIL_INTEGRATION=1 VEIL_QUOTE_E2E=1 VEIL_E2E_PRIVATE_KEY=<funded testnet key>
 * VEIL_QUOTE_E2E_CASES='[{"from":"...","to":"...","amountIn":"1000","hops":1},
 *                       {"from":"...","to":"...","amountIn":"1000","hops":2}]'
 *
 * Fixtures must include one direct route and one actual API-selected 2–3-hop
 * route. A fully connected graph may offer only direct routes: point
 * VEIL_DEX_API_URL at a test deployment with the required topology. This suite
 * fails before spending if either fixture is missing or routes differently;
 * it never manufactures a multi-hop quote or silently skips that coverage.
 * Optional VEIL_DEX_PROGRAM, VEIL_DEX_API_TOKEN, VEIL_BLINDED_STORE,
 * ALEO_DPS_URL and ALEO_RSS_URL select provisioned services.
 */
const RUN = process.env.VEIL_INTEGRATION === '1' && process.env.VEIL_QUOTE_E2E === '1'
const TX_TIMEOUT = 600_000

type QuoteCase = { from: string; to: string; amountIn: string; hops: 1 | 2 | 3; slippageBps?: number }
type LiveClient = ReturnType<Awaited<ReturnType<typeof loadNetwork>>['createAleoClient']>['walletClient'] &
  ReturnType<ReturnType<typeof shieldSwapActions>>

describe.runIf(RUN)('quote → swap → claim against live testnet', () => {
  let client: LiveClient
  let cases: QuoteCase[]
  const importsByCase = new Map<QuoteCase, Record<string, string>>()
  const params = (fixture: QuoteCase): QuoteParameters => ({
    from: fixture.from, to: fixture.to, amountIn: BigInt(fixture.amountIn),
    slippageBps: fixture.slippageBps ?? 500,
  })

  beforeAll(async () => {
    if (!process.env.VEIL_E2E_PRIVATE_KEY) throw new Error('VEIL_E2E_PRIVATE_KEY must hold funded testnet input records and fee credits')
    cases = JSON.parse(process.env.VEIL_QUOTE_E2E_CASES ?? '[]') as QuoteCase[]
    if (!Array.isArray(cases) || !cases.some((c) => c.hops === 1) || !cases.some((c) => c.hops === 2 || c.hops === 3)) {
      throw new Error('VEIL_QUOTE_E2E_CASES must configure direct and multi-hop fixtures; multi-hop must be returned by the real API')
    }
    for (const c of cases) {
      if (!c.from || !c.to || !/^[1-9]\d*$/.test(c.amountIn) || ![1, 2, 3].includes(c.hops)) {
        throw new Error('Invalid quote fixture: require from, to, positive raw amountIn and hops (1–3)')
      }
    }
    const aleo = await loadNetwork('testnet')
    const { walletClient } = aleo.createAleoClient({
      privateKey: process.env.VEIL_E2E_PRIVATE_KEY,
      networkUrl: 'https://edge.provable.com/api/v2',
      provingMode: 'delegated',
      ...(process.env.ALEO_DPS_URL ? { proverUrl: process.env.ALEO_DPS_URL } : {}),
      records: aleo.createRemoteScanner(process.env.ALEO_RSS_URL ? { url: process.env.ALEO_RSS_URL } : {}),
      confirmationTimeout: 400_000,
    })
    client = walletClient.extend(shieldSwapActions({
      program: process.env.VEIL_DEX_PROGRAM,
      api: { baseUrl: process.env.VEIL_DEX_API_URL, apiToken: process.env.VEIL_DEX_API_TOKEN },
      blindedIdentities: fileBlindedIdentityStore(process.env.VEIL_BLINDED_STORE ?? join(tmpdir(), 'veil-quote-e2e-identities.json')),
    }))
    if (!process.env.VEIL_DEX_API_TOKEN) await client.authenticateShieldSwap()

    // Validate every fixture and preload imports before any test spends funds.
    for (const fixture of cases) {
      const quote = await client.quote(params(fixture))
      expect(quote.hops.length, `${fixture.from} → ${fixture.to} must exercise ${fixture.hops} hops`).toBe(fixture.hops)
      const ids = new Set(quote.hops.flatMap((hop) => [hop.tokenInId, hop.tokenOutId]))
      const tokens = await Promise.all([...ids].map((id) => client.tokenData(id)))
      importsByCase.set(fixture, await client.resolveDexImports({
        tokenPrograms: tokens.flatMap((token) => token.ammTokenProgram ? [token.ammTokenProgram] : []),
        program: quote.program,
      }))
    }
  }, 180_000)

  // Run sequentially: even distinct routes can spend records of the same token.
  for (const kind of ['direct', 'multi-hop'] as const) {
    it(`quotes, executes and claims ${kind} swaps with the accepted floor`, async () => {
      for (const fixture of cases.filter((c) => kind === 'direct' ? c.hops === 1 : c.hops > 1)) {
        const imports = importsByCase.get(fixture)!
        // Fresh quote immediately before submission; never reuse a setup quote.
        const quote = await client.quote(params(fixture))
        expect(quote.hops).toHaveLength(fixture.hops)
        expect(quote.expectedOut).toBeGreaterThan(0n)
        expect(quote.minOut).toBe(quote.expectedOut * BigInt(10_000 - quote.slippageBps) / 10_000n)
        const handle = await client.swap({ quote, imports })
        expect(handle.transactionId).toBeTruthy()
        expect(handle.swapId).toBeTruthy()
        if ('amountOutMin' in handle) {
          expect(handle.amountOutMin).toBe(quote.minOut)
          expect(handle.poolKeys).toEqual(quote.hops.map((hop) => hop.poolKey))
        } else {
          expect(handle.poolKey).toBe(quote.hops[0]!.poolKey)
        }

        let output = await client.getSwapOutput({ swapId: handle.swapId!, program: quote.program })
        for (let attempt = 0; !output && attempt < 40; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 3000))
          output = await client.getSwapOutput({ swapId: handle.swapId!, program: quote.program })
        }
        expect(output, 'swap must finalize before claiming').not.toBeNull()
        expect(output!.token_out).toBe(quote.to.id)
        expect(output!.amount_out).toBeGreaterThanOrEqual(quote.minOut)
        const receipt = await client.getSwapExecution({ swapId: handle.swapId!, program: quote.program })
        expect(receipt?.hops).toHaveLength(fixture.hops)
        const claim = await client.claimSwapOutput({ handle, imports })
        expect(claim.amountOut).toBe(output!.amount_out)
        expect(claim.transactionId).toBeTruthy()
      }
    }, TX_TIMEOUT)
  }
})
