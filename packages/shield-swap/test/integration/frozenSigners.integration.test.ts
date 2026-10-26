import { beforeAll, describe, expect, it } from 'vitest'
import { createClient, createPublicClient, http, type Client, type Transport } from '@provablehq/veil-core'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { ApiClient, SHIELD_SWAP_API_URLS } from '../../src/api/client.js'
import { getPool } from '../../src/actions/reads/getPool.js'
import { getSlot } from '../../src/actions/reads/getSlot.js'
import { swap } from '../../src/actions/swap/swap.js'
import { swapMultiHop } from '../../src/actions/swap/swapMultiHop.js'
import { ammProofContext, resolveComplianceProofs } from '../../src/utils/resolveProofs.js'
import { clearRouteCache, resolveTokenRoute } from '../../src/utils/routing.js'

// Live testnet preparation only: real mapping/API reads and real proof generation.
// No record scan, transaction prover, signing capability, or broadcast is installed.
const RUN = process.env.VEIL_FROZEN_TESTS === '1'
const ammList = 'shield_swap_freezelist.aleo'
const tokenList = 'test_usdcx_freezelist.aleo'
const program = process.env.VEIL_DEX_PROGRAM ?? 'shield_swap.aleo'
const httpTransport = http('https://edge.provable.com/api/v2', { network: 'testnet' })
const request: Transport['request'] = args => {
  if (!['getMappingValue', 'getLatestHeight', 'getComplianceFreezeList'].includes(args.method)) {
    throw new Error(`Frozen-signer tests cannot send ${args.method}`)
  }
  return httpTransport.request(args)
}
const transport: Transport = { config: { ...httpTransport.config, request }, request }
const publicClient = createPublicClient({ transport })
let sdk: Awaited<ReturnType<typeof loadNetwork>>

// Pool discovery is needed only when the signer is frozen on the input token's
// list. Confirm API-discovered pools and wrapper relationships against the chain.
async function discoverRoute() {
  clearRouteCache()
  const api = new ApiClient({ baseUrl: process.env.VEIL_DEX_API_URL ?? SHIELD_SWAP_API_URLS.testnet })
  const listed = await api.getPools({ limit: 50 })
  const pools = await Promise.all(listed.data.map(async ({ key }) => ({
    key, pool: await getPool(publicClient, { poolKey: key, program }),
    slot: await getSlot(publicClient, { poolKey: key, program }),
  })))
  const active = pools.filter(p => p.pool?.enabled && (p.slot?.liquidity ?? 0n) > 0n)
  let singleHop: { tokenInId: string; poolKeys: string[] } | undefined
  for (const first of active) for (const tokenInId of [first.pool!.token0, first.pool!.token1]) {
    const route = await resolveTokenRoute(publicClient, { tokenId: tokenInId, program })
    if (!route.wrapped || route.underlyingProgram !== 'test_usdcx_stablecoin.aleo') continue
    const middle = first.pool!.token0 === tokenInId ? first.pool!.token1 : first.pool!.token0
    const second = active.find(p => p.key !== first.key &&
      [p.pool!.token0, p.pool!.token1].includes(middle) &&
      ![p.pool!.token0, p.pool!.token1].includes(tokenInId))
    if (second) return { tokenInId, poolKeys: [first.key, second.key] }
    singleHop ??= { tokenInId, poolKeys: [first.key] }
  }
  if (singleHop) return singleHop
  throw new Error('No active pool with wrapped test USDCx; check the testnet pool fixtures')
}
let route: ReturnType<typeof discoverRoute> | undefined

// The historical variable names may contain either public addresses or their
// private keys. Derive only the address; never install or log the private key.
function configuredAddress(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required when VEIL_FROZEN_TESTS=1`)
  if (value.startsWith('APrivateKey1')) {
    try { return sdk.privateKeyToAccount(value).address }
    catch { throw new Error(`${name} contains an invalid private key`) }
  }
  if (!/^aleo1[0-9a-z]{58}$/.test(value)) throw new Error(`${name} must contain an Aleo address or private key`)
  return value
}

describe.runIf(RUN)('frozen signers against live testnet freezelists', () => {
  beforeAll(async () => { sdk = await loadNetwork('testnet') }, 30_000)

  for (const name of ['FROZEN_ADDRESS_1', 'FROZEN_ADDRESS_2']) describe(name, () => {
    let client: Client
    let address: string
    let ammFrozen: boolean
    let tokenFrozen: boolean

    beforeAll(async () => {
      address = configuredAddress(name)
      const values = await Promise.all([ammList, tokenList].map(programId =>
        publicClient.readContract({ programId, mapping: 'freeze_list', key: address })))
      for (const value of values) expect([null, 'false', 'true']).toContain(value)
      ammFrozen = values[0] === 'true'
      tokenFrozen = values[1] === 'true'
      client = createClient({
        transport,
        account: { type: 'local', address } as Client['account'],
        proving: { mode: 'local', generateFreezelistProof: sdk.generateFreezelistProof },
      })
    }, 30_000)

    it('is actually frozen on a list checked by the swap lifecycle', () => {
      expect(ammFrozen || tokenFrozen,
        `${name} (${address}) is not frozen on ${ammList} or ${tokenList}; populate the intended testnet list before running rejection tests`,
      ).toBe(true)
    })

    it('rejects an automatic single-hop wrapped swap before signing', async ctx => {
      if (!tokenFrozen) ctx.skip(`Signer is not frozen on ${tokenList}; AMM screening occurs at claim`)
      const selected = await (route ??= discoverRoute())
      await expect(swap(client, {
        program, poolKey: selected.poolKeys[0]!, tokenInId: selected.tokenInId,
        amountIn: 1n, expectedOut: 1n, slippageBps: 0,
      })).rejects.toThrow(/^Address is frozen$/)
    }, 60_000)

    it('rejects an automatic multi-hop wrapped swap with null proofs before signing', async ctx => {
      if (!tokenFrozen) ctx.skip(`Signer is not frozen on ${tokenList}; AMM screening occurs at claim`)
      const selected = await (route ??= discoverRoute())
      expect(selected.poolKeys, 'No active two-hop route starting with wrapped test USDCx').toHaveLength(2)
      await expect(swapMultiHop(client, {
        program, poolKeys: selected.poolKeys, tokenInId: selected.tokenInId,
        amountIn: 1n, expectedOut: 1n, slippageBps: 0, proofs: null,
      })).rejects.toThrow(/^Address is frozen$/)
    }, 60_000)

    it('rejects the automatic AMM claim proof against the current root', async ctx => {
      if (!ammFrozen) ctx.skip(`Signer is not frozen on ${ammList}`)
      // A real claim requires a previously settled swap output. Exercise its
      // exact signer context without opening a swap whose output is unclaimable.
      for (const source of [undefined, null]) {
        await expect(resolveComplianceProofs(client, source, [ammProofContext(address, true)]))
          .rejects.toThrow(/^Address is frozen$/)
      }
    }, 30_000)
  })
})
