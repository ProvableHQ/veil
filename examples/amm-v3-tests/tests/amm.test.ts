/**
 * AMM v3 E2E test suite.
 *
 * Run with:
 *   AMM_V3_E2E=1 pnpm vitest run examples/amm-v3-tests/tests/amm.test.ts
 *
 * All tests share a single devnode started in beforeAll. They run sequentially
 * because each suite builds on the on-chain state from the previous one.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createTestClient, http } from '@veil/core'
import type { TestClient, WalletClient, PublicClient } from '@veil/core'
import type { LocalAccount } from '@veil/core'
import { startDevnode, type DevnodeInstance } from '@veil/devnode'
import { createLeoClient } from '@veil/leo'

import { AmmClient, AMM_PROGRAM_ID, AMM_PROGRAM_ADDRESS } from '../src/client/amm-client.js'
import { TokenRegistryClient } from '../src/client/token-registry-client.js'
import { getSqrtPriceAtTick } from '../src/utils/math.js'
import { toField, toU16, toU32 } from '../src/utils/formatting.js'
import { FEE_TIERS, TICK_SPACINGS } from '../src/types/index.js'
import { makeClients } from './helpers/accounts.js'
import { TOKENS, setupToken } from './helpers/tokens.js'

const RUN = process.env.AMM_V3_E2E === '1'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)
const AMM_V3_DIR = resolve(__dirname, '../amm-v3')

// ── Test constants ────────────────────────────────────────────────────────────

const SWAP_AMOUNT    = 10_000_000n   // 10 tokens (6 decimals)
const MINT_AMOUNT    = 100_000_000n  // 100 tokens
const TOKEN_AMOUNT   = 1_000_000_000_000n  // 1M tokens

const TICK_LOWER = -600
const TICK_UPPER =  600

const POOLS = {
  P1: { symbol0: 'TOKA', symbol1: 'TOKB',  fee: FEE_TIERS.MEDIUM, spacing: TICK_SPACINGS.SIXTY },
  P2: { symbol0: 'TOKA', symbol1: 'WCRED', fee: FEE_TIERS.MEDIUM, spacing: TICK_SPACINGS.SIXTY },
  P3: { symbol0: 'TOKB', symbol1: 'WCRED', fee: FEE_TIERS.LOW,    spacing: TICK_SPACINGS.TEN },
}

// ── Shared state (populated in beforeAll / setup tests) ────────────────────────

let devnode:   DevnodeInstance
let testClient: TestClient

let adminWallet:  WalletClient
let adminAccount: LocalAccount<'privateKey'>
let user1Wallet:  WalletClient
let user1Account: LocalAccount<'privateKey'>
let publicClient: PublicClient

let ammClient:           AmmClient
let tokenRegistryClient: TokenRegistryClient

let poolKeyP1: string
let poolKeyP2: string
let poolKeyP3: string

// ── Deployment helpers ────────────────────────────────────────────────────────

async function buildAndDeploy(_name: string, aleoPath: string, leoDir?: string) {
  if (leoDir) {
    const leo = createLeoClient({ cwd: leoDir })
    await leo.build()
  }
  const source = readFileSync(aleoPath, 'utf-8')
  const txId = await adminWallet.deployContract({ program: source })
  await testClient.advanceBlock()
  return txId
}

async function deployAllPrograms() {
  // Advance to height 13 so all deployments land at height 14+ (ConsensusVersion::V14 activates at height 13).
  for (let i = 0; i < 13; i++) await testClient.advanceBlock()
  await buildAndDeploy(
    'token_registry',
    resolve(AMM_V3_DIR, 'build/imports/token_registry.aleo'),
  )
  for (const wrapper of ['test_token_a', 'test_token_b', 'wrapped_native_credits']) {
    const wrapperDir = resolve(AMM_V3_DIR, 'token-wrappers', wrapper)
    await buildAndDeploy(
      wrapper,
      resolve(wrapperDir, 'build/main.aleo'),
      wrapperDir,
    )
  }
  await buildAndDeploy(
    'leo_amm',
    resolve(AMM_V3_DIR, 'build/main.aleo'),
  )
}

// Extracts the first public output field value from a writeContract call.
// The pool key is returned as a public output from create_pool.
async function getPoolKeyFromTx(txId: string): Promise<string> {
  const tx = await publicClient.getTransaction({ id: txId })
  // Walk execution transitions to find the public output field value.
  // getTransaction returns the raw Transaction (not ConfirmedTransaction), so execution is top-level.
  const transitions = tx.execution?.transitions ?? []
  for (const t of transitions) {
    for (const out of t.outputs ?? []) {
      if (out.type === 'public' && out.value?.endsWith('field')) {
        return out.value.replace(/field$/, '')
      }
    }
  }
  throw new Error(`Could not extract pool key from tx ${txId}`)
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe.runIf(RUN)('AMM v3 E2E', () => {
  beforeAll(async () => {
    devnode = await startDevnode({ readyTimeout: 45_000, manualBlockCreation: true })

    testClient = createTestClient({
      transport: http(`http://${devnode.socketAddr}`, { network: 'testnet' }),
    })

    const admin = makeClients('admin', devnode.socketAddr)
    adminWallet  = admin.walletClient
    adminAccount = admin.account
    publicClient = admin.publicClient

    const u1 = makeClients('user1', devnode.socketAddr)
    user1Wallet  = u1.walletClient
    user1Account = u1.account

    ammClient           = new AmmClient(publicClient)
    tokenRegistryClient = new TokenRegistryClient(publicClient)

    await deployAllPrograms()
  }, 300_000)

  afterAll(async () => {
    try { await testClient.shutdown() } catch {}
    try { await devnode.stop() }        catch {}
  })

  // ── 01 Admin setup ──────────────────────────────────────────────────────────

  describe('01 - admin setup', () => {
    it('initializes admin', async () => {
      await adminWallet.writeContract({
        program: AMM_PROGRAM_ID,
        function: 'initialize_admin',
        inputs: [adminAccount.address],
      })
      await testClient.advanceBlock()
      const admin = await ammClient.getAdmin()
      expect(admin).toBe(adminAccount.address)
    })

    it('registers fee tiers', async () => {
      for (const fee of Object.values(FEE_TIERS)) {
        await adminWallet.writeContract({
          program: AMM_PROGRAM_ID,
          function: 'add_fee_tier',
          inputs: [toU16(fee)],
        })
        await testClient.advanceBlock()
      }
      expect(await ammClient.isFeeTierValid(FEE_TIERS.MEDIUM)).toBe(true)
      expect(await ammClient.isFeeTierValid(FEE_TIERS.LOW)).toBe(true)
    })

    it('registers tick spacings', async () => {
      for (const spacing of Object.values(TICK_SPACINGS)) {
        await adminWallet.writeContract({
          program: AMM_PROGRAM_ID,
          function: 'add_tick_spacing',
          inputs: [toU32(spacing)],
        })
        await testClient.advanceBlock()
      }
      expect(await ammClient.isTickSpacingValid(TICK_SPACINGS.SIXTY)).toBe(true)
      expect(await ammClient.isTickSpacingValid(TICK_SPACINGS.TEN)).toBe(true)
    })
  })

  // ── 02 Token setup ──────────────────────────────────────────────────────────

  describe('02 - token setup', () => {
    it('sets up TOKA for admin and user1', async () => {
      await setupToken('TOKA', adminWallet, [adminWallet, user1Wallet], AMM_PROGRAM_ADDRESS, TOKEN_AMOUNT, testClient)
      const meta = await tokenRegistryClient.getTokenMetadata(TOKENS.TOKA!.registryTokenId!)
      expect(meta).not.toBeNull()
    })

    it('sets up TOKB for admin and user1', async () => {
      await setupToken('TOKB', adminWallet, [adminWallet, user1Wallet], AMM_PROGRAM_ADDRESS, TOKEN_AMOUNT, testClient)
    })

    it('sets up WCRED for admin and user1', async () => {
      await setupToken('WCRED', adminWallet, [adminWallet, user1Wallet], AMM_PROGRAM_ADDRESS, TOKEN_AMOUNT, testClient)
    })
  })

  // ── 03 Pool creation ────────────────────────────────────────────────────────

  describe('03 - pool creation', () => {
    it('creates pool P1 (TOKA/TOKB, fee 3000)', async () => {
      const p = POOLS.P1
      const sqrtPrice = getSqrtPriceAtTick(0)
      const txId = await adminWallet.writeContract({
        program: AMM_PROGRAM_ID,
        function: 'create_pool',
        inputs: ammClient.formatCreatePoolInputs(
          TOKENS[p.symbol0]!.ammTokenId,
          TOKENS[p.symbol1]!.ammTokenId,
          p.fee, sqrtPrice, p.spacing, 0,
        ),
      })
      await testClient.advanceBlock()
      poolKeyP1 = await getPoolKeyFromTx(txId)
      expect(await ammClient.isPoolInitialized(poolKeyP1)).toBe(true)
    })

    it('creates pool P2 (TOKA/WCRED, fee 3000)', async () => {
      const p = POOLS.P2
      const sqrtPrice = getSqrtPriceAtTick(0)
      const txId = await adminWallet.writeContract({
        program: AMM_PROGRAM_ID,
        function: 'create_pool',
        inputs: ammClient.formatCreatePoolInputs(
          TOKENS[p.symbol0]!.ammTokenId,
          TOKENS[p.symbol1]!.ammTokenId,
          p.fee, sqrtPrice, p.spacing, 0,
        ),
      })
      await testClient.advanceBlock()
      poolKeyP2 = await getPoolKeyFromTx(txId)
      expect(await ammClient.isPoolInitialized(poolKeyP2)).toBe(true)
    })

    it('creates pool P3 (TOKB/WCRED, fee 500)', async () => {
      const p = POOLS.P3
      const sqrtPrice = getSqrtPriceAtTick(0)
      const txId = await adminWallet.writeContract({
        program: AMM_PROGRAM_ID,
        function: 'create_pool',
        inputs: ammClient.formatCreatePoolInputs(
          TOKENS[p.symbol0]!.ammTokenId,
          TOKENS[p.symbol1]!.ammTokenId,
          p.fee, sqrtPrice, p.spacing, 0,
        ),
      })
      await testClient.advanceBlock()
      poolKeyP3 = await getPoolKeyFromTx(txId)
      expect(await ammClient.isPoolInitialized(poolKeyP3)).toBe(true)
    })
  })

  // ── 04 Liquidity positions ──────────────────────────────────────────────────

  describe('04 - liquidity positions', () => {
    it('mints a position in P1 for user1', async () => {
      const p = POOLS.P1
      const { tickLower, tickUpper } = { tickLower: TICK_LOWER, tickUpper: TICK_UPPER }

      await user1Wallet.writeContract({
        program: AMM_PROGRAM_ID,
        function: 'mint',
        imports: [TOKENS[p.symbol0]!.programId, TOKENS[p.symbol1]!.programId],
        inputs: ammClient.formatMintInputs(
          user1Account.address,
          {
            pool:             poolKeyP1,
            tick_lower:       tickLower,
            tick_upper:       tickUpper,
            amount0_desired:  MINT_AMOUNT,
            amount1_desired:  MINT_AMOUNT,
            amount0_min:      0n,
            amount1_min:      0n,
            tick_lower_hint:  tickLower,
            tick_upper_hint:  tickUpper,
          },
          TOKENS[p.symbol0]!.ammTokenId,
          TOKENS[p.symbol1]!.ammTokenId,
        ),
      })
      await testClient.advanceBlock()

      const slot = await ammClient.getSlot(poolKeyP1)
      expect(slot).not.toBeNull()
      expect(slot!.liquidity).toBeGreaterThan(0n)
    })

    it('mints a position in P2 for user1', async () => {
      const p = POOLS.P2
      await user1Wallet.writeContract({
        program: AMM_PROGRAM_ID,
        function: 'mint',
        imports: [TOKENS[p.symbol0]!.programId, TOKENS[p.symbol1]!.programId],
        inputs: ammClient.formatMintInputs(
          user1Account.address,
          {
            pool:             poolKeyP2,
            tick_lower:       TICK_LOWER,
            tick_upper:       TICK_UPPER,
            amount0_desired:  MINT_AMOUNT,
            amount1_desired:  MINT_AMOUNT,
            amount0_min:      0n,
            amount1_min:      0n,
            tick_lower_hint:  TICK_LOWER,
            tick_upper_hint:  TICK_UPPER,
          },
          TOKENS[p.symbol0]!.ammTokenId,
          TOKENS[p.symbol1]!.ammTokenId,
        ),
      })
      await testClient.advanceBlock()

      const slot = await ammClient.getSlot(poolKeyP2)
      expect(slot?.liquidity).toBeGreaterThan(0n)
    })

    it('mints a position in P3 for user1', async () => {
      const p = POOLS.P3
      await user1Wallet.writeContract({
        program: AMM_PROGRAM_ID,
        function: 'mint',
        imports: [TOKENS[p.symbol0]!.programId, TOKENS[p.symbol1]!.programId],
        inputs: ammClient.formatMintInputs(
          user1Account.address,
          {
            pool:             poolKeyP3,
            tick_lower:       TICK_LOWER,
            tick_upper:       TICK_UPPER,
            amount0_desired:  MINT_AMOUNT,
            amount1_desired:  MINT_AMOUNT,
            amount0_min:      0n,
            amount1_min:      0n,
            tick_lower_hint:  TICK_LOWER,
            tick_upper_hint:  TICK_UPPER,
          },
          TOKENS[p.symbol0]!.ammTokenId,
          TOKENS[p.symbol1]!.ammTokenId,
        ),
      })
      await testClient.advanceBlock()
    })
  })

  // ── 05 Swaps ────────────────────────────────────────────────────────────────

  describe('05 - single-pool swaps', () => {
    async function doSwap(
      poolKey: string,
      token0Id: string,
      token1Id: string,
      token0Program: string,
      token1Program: string,
      zeroForOne: boolean,
      wallet: WalletClient,
    ) {
      const nonce = ammClient.generateNonce()
      const sqrtPriceLimit = zeroForOne
        ? getSqrtPriceAtTick(-1200)
        : getSqrtPriceAtTick(1200)

      const txId = await wallet.writeContract({
        program: AMM_PROGRAM_ID,
        function: 'swap',
        imports: [token0Program, token1Program],
        inputs: ammClient.formatSwapInputs(
          {
            pool:             poolKey,
            zero_for_one:     zeroForOne,
            amount_in:        SWAP_AMOUNT,
            amount_out_min:   0n,
            sqrt_price_limit: sqrtPriceLimit,
            recipient:        (wallet as unknown as { account: { address: string } }).account.address,
            tick_hint_0:      0,
            tick_hint_1:      0,
            nonce,
            deadline:         4294967295,
          },
          token0Id,
          token1Id,
        ),
      })
      await testClient.advanceBlock()
      return txId
    }

    it('S1: TOKA → TOKB (P1, zero_for_one)', async () => {
      const p = POOLS.P1
      await doSwap(poolKeyP1, TOKENS[p.symbol0]!.ammTokenId, TOKENS[p.symbol1]!.ammTokenId, TOKENS[p.symbol0]!.programId, TOKENS[p.symbol1]!.programId, true, adminWallet)
      const slot = await ammClient.getSlot(poolKeyP1)
      expect(slot).not.toBeNull()
    })

    it('S2: TOKB → TOKA (P1, one_for_zero)', async () => {
      const p = POOLS.P1
      await doSwap(poolKeyP1, TOKENS[p.symbol0]!.ammTokenId, TOKENS[p.symbol1]!.ammTokenId, TOKENS[p.symbol0]!.programId, TOKENS[p.symbol1]!.programId, false, adminWallet)
    })

    it('S3: TOKA → WCRED (P2, zero_for_one)', async () => {
      const p = POOLS.P2
      await doSwap(poolKeyP2, TOKENS[p.symbol0]!.ammTokenId, TOKENS[p.symbol1]!.ammTokenId, TOKENS[p.symbol0]!.programId, TOKENS[p.symbol1]!.programId, true, adminWallet)
    })

    it('S4: WCRED → TOKA (P2, one_for_zero)', async () => {
      const p = POOLS.P2
      await doSwap(poolKeyP2, TOKENS[p.symbol0]!.ammTokenId, TOKENS[p.symbol1]!.ammTokenId, TOKENS[p.symbol0]!.programId, TOKENS[p.symbol1]!.programId, false, adminWallet)
    })

    it('S5: TOKB → WCRED (P3, zero_for_one)', async () => {
      const p = POOLS.P3
      await doSwap(poolKeyP3, TOKENS[p.symbol0]!.ammTokenId, TOKENS[p.symbol1]!.ammTokenId, TOKENS[p.symbol0]!.programId, TOKENS[p.symbol1]!.programId, true, adminWallet)
    })

    it('S6: WCRED → TOKB (P3, one_for_zero)', async () => {
      const p = POOLS.P3
      await doSwap(poolKeyP3, TOKENS[p.symbol0]!.ammTokenId, TOKENS[p.symbol1]!.ammTokenId, TOKENS[p.symbol0]!.programId, TOKENS[p.symbol1]!.programId, false, adminWallet)
    })
  })

  // ── 06 Multi-hop swaps ──────────────────────────────────────────────────────

  describe('06 - multi-hop swaps', () => {
    it('M1: TOKA → TOKB → WCRED via P1, P3', async () => {
      const nonce = ammClient.generateNonce()
      const sqrtLimit = getSqrtPriceAtTick(-1200)
      await adminWallet.writeContract({
        program: AMM_PROGRAM_ID,
        function: 'swap_multi_hop',
        imports: [TOKENS.TOKA!.programId, TOKENS.TOKB!.programId, TOKENS.WCRED!.programId],
        inputs: ammClient.formatSwapMultiHopInputs({
          token_in:       TOKENS.TOKA!.ammTokenId,
          token_out:      TOKENS.WCRED!.ammTokenId,
          amount_in:      SWAP_AMOUNT,
          amount_out_min: 0n,
          recipient:      adminAccount.address,
          hop0: {
            pool: poolKeyP1, zero_for_one: true,
            tick_hint_0: 0, tick_hint_1: 0, sqrt_price_limit: sqrtLimit,
          },
          hop1: {
            pool: poolKeyP3, zero_for_one: true,
            tick_hint_0: 0, tick_hint_1: 0, sqrt_price_limit: sqrtLimit,
          },
          hop2: {
            pool: poolKeyP3, zero_for_one: true,
            tick_hint_0: 0, tick_hint_1: 0, sqrt_price_limit: sqrtLimit,
          },
          hop_count: 2,
          nonce,
          deadline:  4294967295,
          caller:    adminAccount.address,
        }),
      })
      await testClient.advanceBlock()
    })
  })

  // ── 07 Fee collection ───────────────────────────────────────────────────────

  describe('07 - fee collection', () => {
    it('TODO: collect LP fees from P1 position', async () => {
      // Requires the NFT record from the mint_position output.
      // Will be implemented once record extraction from tx outputs is wired up.
      expect(true).toBe(true)
    })
  })

  // ── 08 Position lifecycle ───────────────────────────────────────────────────

  describe('08 - position lifecycle', () => {
    it('TODO: decrease liquidity and burn position', async () => {
      // Requires the NFT record from the mint_position output.
      expect(true).toBe(true)
    })
  })

  // ── 09 Protocol fees ────────────────────────────────────────────────────────

  describe('09 - protocol fees', () => {
    it('sets protocol fee on P1', async () => {
      await adminWallet.writeContract({
        program: AMM_PROGRAM_ID,
        function: 'set_fee_protocol',
        inputs: [toField(poolKeyP1), '4u8'],
      })
      await testClient.advanceBlock()
      const slot = await ammClient.getSlot(poolKeyP1)
      expect(slot?.fee_protocol).toBe(4)
    })
  })
})
