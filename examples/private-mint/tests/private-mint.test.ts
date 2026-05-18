/**
 * Private mint with wrapper program E2E test suite.
 *
 * Run with:
 *   usdcx-private-mint=1 pnpm vitest run examples/usdcx-private-mint/private-mint-test.ts
 *
 * All tests share a single devnode started in beforeAll. They run sequentially
 * because each suite builds on the on-chain state from the previous one.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createTestClient, http, type TestClient, type WalletClient, type PublicClient } from '@veil/core'
import type { LocalAccount } from '@veil/core'
import { startDevnode, type DevnodeInstance } from '@veil/devnode'
import { createDevnodeClient } from '@veil/provable'
import { createLeoClient } from '@veil/leo'


const RUN = process.env.PRIVATE_MINT_E2E === '1'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)
const WRAPPER_DIR = resolve(__dirname, '..', 'private-mint-wrapper')

// ── Test constants ────────────────────────────────────────────────────────────



// ── Shared state (populated in beforeAll / setup tests) ────────────────────────

let devnode:   DevnodeInstance
let testClient: TestClient

let adminWallet:  WalletClient
let adminAccount: LocalAccount<'privateKey'>
let publicClient: PublicClient


// ── Deployment helpers ────────────────────────────────────────────────────────

async function buildAndDeploy(_name: string, aleoPath: string, leoDir?: string) {
  if (leoDir) {
    const leo = createLeoClient({ cwd: leoDir, quiet: true, network: 'testnet', endpoint: `http://${devnode.socketAddr}` })
    await leo.build()
  }
  const source = readFileSync(aleoPath, 'utf-8')
  const txId = await adminWallet.deployContract({ program: source })
  return txId
}

async function deployAllPrograms() {
  await buildAndDeploy(
    'merkle_tree',
    resolve(WRAPPER_DIR, 'build/imports/merkle_tree.aleo'),
    WRAPPER_DIR,
  )
  await buildAndDeploy(
    'test_usdcx_multisig_core',
    resolve(WRAPPER_DIR, 'imports/test_usdcx_multisig_core.aleo'),
  )
  await buildAndDeploy(
    'test_usdcx_freezelist',
    resolve(WRAPPER_DIR, 'imports/test_usdcx_freezelist.aleo'),
  )
  await buildAndDeploy(
    'test_usdcx_stablecoin',
    resolve(WRAPPER_DIR, 'imports/test_usdcx_stablecoin.aleo'),
  )
  await buildAndDeploy(
    'test_usdcx_bridge',
    resolve(WRAPPER_DIR, 'imports/test_usdcx_bridge.aleo'),
  )
  await buildAndDeploy(
    'wrapper_demo',
    resolve(WRAPPER_DIR, 'build/main.aleo'),
  )
}



// ── Test suite ────────────────────────────────────────────────────────────────

describe.runIf(RUN)('PRIVATE MINT E2E', () => {
  beforeAll(async () => {
    devnode = await startDevnode({ readyTimeout: 45_000, manualBlockCreation: false })

    testClient = createTestClient({ transport: http(`http://${devnode.socketAddr}`, { network: 'testnet' }) })

    const admin = createDevnodeClient({ socketAddr: devnode.socketAddr })
    adminWallet  = admin.walletClient
    adminAccount = admin.account
    publicClient = admin.publicClient

    await deployAllPrograms()
  }, 300_000)

  afterAll(async () => {
    try { await testClient.shutdown() } catch {}
    try { await devnode.stop() }        catch {}
  }, 30_000)

  // ── 01 Initialize USDCx stablecoin and bridge ────────────────────────────────

  describe('01 - initialize stablecoin and bridge', () => {
    it('initializes the freeze list', async () => {
      await adminWallet.writeContract({
        program: 'test_usdcx_freezelist.aleo',
        function: 'initialize',
        inputs: [adminAccount.address, '100u32'],
      })
      const role = await publicClient.readMapping({
        programId: 'test_usdcx_freezelist.aleo',
        mapping: 'address_to_role',
        key: adminAccount.address,
      })
      expect(role).toBe('8u16')
    })

    it('initializes the USDCX stablecoin program', async () => {
      await adminWallet.writeContract({
        program: 'test_usdcx_stablecoin.aleo',
        function: 'initialize',
        inputs: ['1u128', '1u128', '6u8', '123456789123456789u128', adminAccount.address],
      })
      const role = await publicClient.readMapping({
        programId: 'test_usdcx_stablecoin.aleo',
        mapping: 'address_to_role',
        key: adminAccount.address,
      })
      expect(role).toBe('8u16')
    })

    it('grants minter/burner role to the bridge', async () => {
      const bridgeAddress = 'aleo1khwgr8x8f9ywwx2p4w55hm0x7rczcf2weqn7nsxcwqckpcgwvczq3wzkwx'
      await adminWallet.writeContract({
        program: 'test_usdcx_stablecoin.aleo',
        function: 'update_role',
        inputs: [bridgeAddress, '3u16'],
      })
      const role = await publicClient.readMapping({
        programId: 'test_usdcx_stablecoin.aleo',
        mapping: 'address_to_role',
        key: bridgeAddress,
      })
      expect(role).toBe('3u16')
    })
  })

  // ── 02 Private mint ──────────────────────────────────────────────────────────

  describe('02 - mint_and_send_private', () => {
    const payload  = '[90u8, 46u8, 10u8, 205u8, 0u8, 0u8, 0u8, 1u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 152u8, 150u8, 128u8, 0u8, 0u8, 39u8, 18u8, 177u8, 67u8, 237u8, 82u8, 199u8, 116u8, 205u8, 29u8, 74u8, 81u8, 157u8, 14u8, 121u8, 111u8, 21u8, 145u8, 107u8, 229u8, 169u8, 225u8, 212u8, 94u8, 220u8, 217u8, 133u8, 45u8, 210u8, 63u8, 104u8, 245u8, 52u8, 1u8, 95u8, 61u8, 75u8, 246u8, 135u8, 83u8, 141u8, 76u8, 35u8, 213u8, 12u8, 86u8, 111u8, 12u8, 81u8, 194u8, 124u8, 133u8, 60u8, 16u8, 183u8, 39u8, 31u8, 81u8, 31u8, 149u8, 178u8, 63u8, 51u8, 76u8, 25u8, 10u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 28u8, 125u8, 75u8, 25u8, 108u8, 176u8, 199u8, 176u8, 29u8, 116u8, 63u8, 188u8, 97u8, 22u8, 169u8, 2u8, 55u8, 156u8, 114u8, 56u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 30u8, 25u8, 109u8, 10u8, 125u8, 129u8, 137u8, 5u8, 76u8, 77u8, 183u8, 68u8, 171u8, 51u8, 64u8, 195u8, 241u8, 198u8, 139u8, 25u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 1u8, 134u8, 160u8, 180u8, 125u8, 34u8, 77u8, 134u8, 8u8, 93u8, 12u8, 86u8, 236u8, 88u8, 230u8, 162u8, 93u8, 169u8, 246u8, 188u8, 109u8, 110u8, 75u8, 174u8, 134u8, 165u8, 59u8, 62u8, 120u8, 204u8, 241u8, 104u8, 66u8, 113u8, 75u8, 0u8, 0u8, 0u8, 0u8]'
    const sig      = '[19u8, 105u8, 51u8, 13u8, 237u8, 80u8, 138u8, 87u8, 161u8, 185u8, 166u8, 77u8, 142u8, 5u8, 15u8, 79u8, 105u8, 101u8, 86u8, 91u8, 73u8, 88u8, 251u8, 29u8, 230u8, 60u8, 245u8, 68u8, 132u8, 149u8, 166u8, 112u8, 7u8, 24u8, 78u8, 69u8, 194u8, 178u8, 93u8, 35u8, 73u8, 67u8, 114u8, 247u8, 191u8, 1u8, 156u8, 216u8, 15u8, 222u8, 122u8, 52u8, 140u8, 250u8, 209u8, 16u8, 228u8, 5u8, 144u8, 181u8, 64u8, 226u8, 220u8, 212u8, 28u8]'
    const digest   = '[173u8, 0u8, 115u8, 131u8, 217u8, 69u8, 125u8, 6u8, 56u8, 241u8, 5u8, 99u8, 8u8, 32u8, 76u8, 245u8, 109u8, 176u8, 182u8, 163u8, 59u8, 114u8, 149u8, 129u8, 255u8, 60u8, 211u8, 36u8, 253u8, 162u8, 64u8, 155u8]'
    const hookData = '[1u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8, 0u8]'
    const nonce    = '[180u8, 125u8, 34u8, 77u8, 134u8, 8u8, 93u8, 12u8, 86u8, 236u8, 88u8, 230u8, 162u8, 93u8, 169u8, 246u8, 188u8, 109u8, 110u8, 75u8, 174u8, 134u8, 165u8, 59u8, 62u8, 120u8, 204u8, 241u8, 104u8, 66u8, 113u8, 75u8]'
    
    it('nullifier is unset before mint', async () => {
      const result = await publicClient.readMapping({
        programId: 'test_usdcx_bridge.aleo',
        mapping: 'nullifier',
        key: nonce,
      })
      expect(result).toBeNull()
    })

    it('mints USDCx privately to the recipient', async () => {
      await adminWallet.writeContract({
        program: 'bridge_demo_v1.aleo',
        function: 'mint_and_send_private',
        inputs: [payload, sig, digest, hookData],
      })
      const nullifierSet = await publicClient.readMapping({
        programId: 'test_usdcx_bridge.aleo',
        mapping: 'nullifier',
        key: nonce,
      })
      expect(nullifierSet).toBe('true')
    })
  })
})