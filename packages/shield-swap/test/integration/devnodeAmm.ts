import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { startDevnode, type DevnodeInstance } from '@provablehq/veil-aleo-devnode'
import { createDevnodeClient, loadNetwork, generateAccount, type AleoSdk } from '@provablehq/veil-aleo-sdk'
import { createTestClient, http } from '@provablehq/veil-core'
import type { PublicClient, WalletClient, TestClient, LocalAccount, ConfirmedTransaction } from '@provablehq/veil-core'

import { shieldSwapActions } from '../../src/decorators/shieldSwapActions.js'
import { programToTokenId } from '../../src/utils/routing.js'
import type { MerkleProofInput, ProofProvider } from '../../src/utils/proofs.js'
import { EMPTY_MERKLE_PROOFS } from '../../src/utils/proofs.js'

/**
 * Compile-from-source devnode fixture for the `shield_swap.aleo` stack. Builds
 * the AMM, its multisig/freezelist imports, the routers, and the fake token
 * wrappers from the amm-v3 Leo sources (development tree), deploys them with the
 * devnode genesis admin — which equals the `DEPLOYER` the AMM constructor
 * asserts against — then bootstraps fee tiers, tick spacings, token
 * registration, three pools (plain/plain, wrapped/plain, wrapped/wrapped), and
 * router-seeded liquidity. The two lifecycle suites drive SDK actions and the
 * generated contract through this fixture.
 *
 * Requires `leo` and `aleo-devnode` on PATH and a checkout of the amm-v3
 * sources — the sibling `~/dev/amm-v3` by default, or `AMM_V3_ROOT`. Use
 * {@link ammV3SourceAvailable} to skip the suites when the sources are absent.
 */

/** The core AMM program id — the migrated `shield_swap.aleo`. */
export const AMM_PROGRAM = 'shield_swap.aleo'
/** The single fee tier the fixture registers; every pool uses it. */
export const FEE = 3000
/** The tick spacing bound to {@link FEE}. */
export const TICK_SPACING = 60

/** Root of the amm-v3 Leo sources — `AMM_V3_ROOT` or the sibling checkout. */
export const AMM_V3_ROOT = process.env.AMM_V3_ROOT ?? join(homedir(), 'dev', 'amm-v3')

/** True when the amm-v3 Leo sources are resolvable, so the devnode suites can run. */
export function ammV3SourceAvailable(): boolean {
  return existsSync(join(AMM_V3_ROOT, 'src', 'main.leo'))
}

// Program id → project directory, in deploy order (underlying before wrapper).
// test_token_a is a second plain ARC-20 (amm-v3's own reference plain token),
// added so a plain/plain pool has two distinct plain sides.
const PROGRAMS: ReadonlyArray<readonly [string, string]> = [
  ['shield_swap_multisig_core.aleo', join(AMM_V3_ROOT, 'shield_swap_multisig_core')],
  ['shield_swap_freezelist.aleo', join(AMM_V3_ROOT, 'shield_swap_freezelist')],
  ['shield_swap.aleo', AMM_V3_ROOT],
  ['fake_credits.aleo', join(AMM_V3_ROOT, 'token-wrappers', 'fake_credits')],
  ['fake_wcredits.aleo', join(AMM_V3_ROOT, 'token-wrappers', 'fake_wcredits')],
  ['fake_usdcx_freezelist.aleo', join(AMM_V3_ROOT, 'token-wrappers', 'fake_usdcx_freezelist')],
  ['fake_usdcx.aleo', join(AMM_V3_ROOT, 'token-wrappers', 'fake_usdcx')],
  ['fake_wusdcx.aleo', join(AMM_V3_ROOT, 'token-wrappers', 'fake_wusdcx')],
  ['fake_usad_freezelist.aleo', join(AMM_V3_ROOT, 'token-wrappers', 'fake_usad_freezelist')],
  ['fake_usad.aleo', join(AMM_V3_ROOT, 'token-wrappers', 'fake_usad')],
  ['fake_wrapped_usad.aleo', join(AMM_V3_ROOT, 'token-wrappers', 'fake_wrapped_usad')],
  ['fake_plainhitok.aleo', join(AMM_V3_ROOT, 'token-wrappers', 'fake_plainhitok')],
  ['test_token_a.aleo', join(AMM_V3_ROOT, 'token-wrappers', 'test_token_a')],
  ['shield_swap_router.aleo', join(AMM_V3_ROOT, 'shield_swap_router')],
  ['shield_swap_lp_router.aleo', join(AMM_V3_ROOT, 'shield_swap_lp_router')],
]

const FREEZELIST_PROGRAM = 'shield_swap_freezelist.aleo'

// The fake stablecoin wrappers (fake_wusdcx / fake_wrapped_usad) gate their
// deposit/withdraw on a fixed sentinel non-inclusion witness — distinct from
// the AMM's empty-tree witness — encoded in fake_usdcx.aleo as
// WRAPPER_TEST_PROOF_{0,1}_SIBLINGS. The credits wrapper (fake_wcredits)
// ignores its proof argument. A single provider covers all wrapped sides:
// sentinel for the wrapper freezelists, empty-tree for the AMM's own.
const sentinelSiblings = (start: number): string[] =>
  Array.from({ length: 16 }, (_unused, i) => `${start + i}field`)
const WRAPPER_SENTINEL_PROOFS: readonly [MerkleProofInput, MerkleProofInput] = [
  { siblings: sentinelSiblings(1), leaf_index: 0 },
  { siblings: sentinelSiblings(17), leaf_index: 1 },
]

/** Non-inclusion witnesses for the devnode: sentinel per wrapper, empty-tree for the AMM. */
export const devnodeProofProvider: ProofProvider = async (context) =>
  context.list === 'wrapper' ? WRAPPER_SENTINEL_PROOFS : EMPTY_MERKLE_PROOFS

export type DevnodeActor = {
  publicClient: PublicClient
  walletClient: WalletClient
  account: LocalAccount<'privateKey'>
}

/** A token this fixture deploys, with its AMM-facing id and record particulars. */
export type TokenInfo = {
  /** Program id (e.g. `fake_wcredits.aleo`). */
  program: string
  /** AMM token id as a `field` literal. */
  field: string
  /** True when the token is a router-mediated wrapper. */
  wrapped: boolean
  /** Underlying program id whose records the user spends (wrapped tokens only). */
  underlyingProgram?: string
  /** Bit-width of the underlying record's `amount` (`u64` credits, `u128` others). */
  underlyingWidth?: 'u64' | 'u128'
}

/** A bootstrapped pool with its sorted token sides. */
export type PoolInfo = {
  name: string
  poolKey: string
  token0: TokenInfo
  token1: TokenInfo
}

export type AmmDevnode = {
  devnode: DevnodeInstance
  testClient: TestClient
  aleo: AleoSdk
  admin: DevnodeActor
  user: DevnodeActor
  /** Program id → source, for the wasm's dynamic-dispatch import resolution. */
  imports: Record<string, string>
  /** Freezelist non-inclusion provider (sentinel/empty). Pass to every routed call. */
  proofs: ProofProvider
  fee: number
  tickSpacing: number
  tokens: {
    plainA: TokenInfo
    plainH: TokenInfo
    wcredits: TokenInfo
    wusdcx: TokenInfo
  }
  pools: {
    /** plain / plain: test_token_a + fake_plainhitok. */
    pp: PoolInfo
    /** wrapped / plain: fake_wcredits + fake_plainhitok. */
    wp: PoolInfo
    /** wrapped / wrapped: fake_wcredits + fake_wusdcx. */
    ww: PoolInfo
  }
  /**
   * Mints a plain token to the user and privatizes it, returning the user-owned
   * Token record plaintext.
   */
  mintPlainToUser: (tokenProgram: string, amount: bigint) => Promise<string>
  /**
   * Admin-mints a wrapped token's underlying asset directly to the user as a
   * private record, returning the user-owned record plaintext.
   */
  mintUnderlyingToUser: (underlyingProgram: string, amount: bigint, width: 'u64' | 'u128') => Promise<string>
  /** Decrypts the caller-owned records of a confirmed transaction. */
  recordsOf: (viewKey: string, txId: string) => Promise<string[]>
  stop: () => Promise<void>
}

/** Numeric compare of two `field` literals. */
function fieldLt(a: string, b: string): boolean {
  return BigInt(a.replace(/field$/, '')) < BigInt(b.replace(/field$/, ''))
}

/** Builds a {@link TokenInfo} from its program id and wrapper relationship. */
function tokenInfo(program: string, underlying?: { program: string; width: 'u64' | 'u128' }): TokenInfo {
  return {
    program,
    field: programToTokenId(program),
    wrapped: underlying !== undefined,
    ...(underlying ? { underlyingProgram: underlying.program, underlyingWidth: underlying.width } : {}),
  }
}

async function waitAccepted(actor: DevnodeActor, testClient: TestClient, txId: string, label: string) {
  await testClient.advanceBlock({ count: 1 })
  const { status } = await actor.walletClient.transactionStatus({ transactionId: txId })
  if (status !== 'accepted') throw new Error(`${label}: transaction ${txId} is ${status}`)
}

/**
 * Waits until the devnode serves a deployed program's source. Acceptance and
 * queryability are not atomic on the devnode, and the wasm resolves a program's
 * imports from the node while building the next deployment.
 */
async function waitQueryable(actor: DevnodeActor, testClient: TestClient, programId: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const source = await actor.publicClient.getCode({ programId })
      if (source.includes(`program ${programId}`)) return
    } catch {
      // not served yet
    }
    await testClient.advanceBlock({ count: 1 })
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${programId} never became queryable on the devnode`)
}

/** Builds one amm-v3 program from source and returns its compiled Aleo instructions. */
function buildProgram(programId: string, projectDir: string): string {
  const leo = process.env.LEO_BIN ?? 'leo'
  execFileSync(leo, ['build'], { cwd: projectDir, stdio: 'pipe' })
  const nameNoExt = programId.replace(/\.aleo$/, '')
  return readFileSync(join(projectDir, 'build', nameNoExt, `${nameNoExt}.aleo`), 'utf-8')
}

/** Boots a devnode with the full shield_swap stack deployed, configured, and seeded. */
export async function setupAmmDevnode(): Promise<AmmDevnode> {
  if (!ammV3SourceAvailable()) {
    throw new Error(
      `amm-v3 Leo sources not found at ${AMM_V3_ROOT} — set AMM_V3_ROOT to a checkout of the amm-v3 development tree.`,
    )
  }

  // Compile every program from source up front (one-time, ~15s cold).
  const sources: Record<string, string> = {}
  for (const [programId, projectDir] of PROGRAMS) {
    sources[programId] = buildProgram(programId, projectDir)
  }

  const devnode = await startDevnode({ readyTimeout: 60_000, verbose: process.env.VEIL_DEVNODE_VERBOSE === '1' })
  const testClient = createTestClient({
    transport: http(`http://${devnode.socketAddr}`, { network: 'testnet' }),
  })
  const aleo = await loadNetwork('testnet')

  // The devnode genesis account equals the AMM's baked DEPLOYER and every fake
  // token's ADMIN, so it is both the deployer and the mint/admin authority.
  const adminPair = createDevnodeClient({ socketAddr: devnode.socketAddr })
  const admin: DevnodeActor = {
    publicClient: adminPair.publicClient,
    walletClient: adminPair.walletClient,
    account: adminPair.account,
  }

  await testClient.advanceBlock({ count: 1 })

  for (const [programId] of PROGRAMS) {
    const txId = await admin.walletClient.deployContract({ program: sources[programId]! })
    await waitAccepted(admin, testClient, txId, `deploy ${programId}`)
    await waitQueryable(admin, testClient, programId)
  }

  // Every dynamic-dispatch call resolves its callees from this closure; passing
  // all sources is harmless and covers each dispatch path.
  const imports: Record<string, string> = { ...sources }

  // A non-admin user drives the lifecycle flows and proves the open-pool gate.
  const userAccount = generateAccount()
  const userPair = createDevnodeClient({ privateKey: userAccount.privateKey, socketAddr: devnode.socketAddr })
  const user: DevnodeActor = {
    publicClient: userPair.publicClient,
    walletClient: userPair.walletClient,
    account: userPair.account,
  }

  // Fund the user's public credits balance so it can pay transaction fees.
  const fundTx = await admin.walletClient.writeContract({
    program: 'credits.aleo',
    function: 'transfer_public',
    inputs: [user.account.address, '1000000000u64'],
  })
  await waitAccepted(admin, testClient, fundTx, 'fund user')

  const adminDex = admin.walletClient.extend(shieldSwapActions({ program: AMM_PROGRAM })) as ReturnType<
    ReturnType<typeof shieldSwapActions>
  >

  const recordsOf = async (viewKey: string, txId: string): Promise<string[]> => {
    const confirmed = (await admin.publicClient.request({
      method: 'getConfirmedTransaction',
      params: { id: txId },
    })) as ConfirmedTransaction | null
    const transitions =
      ((confirmed?.transaction as { execution?: { transitions?: Array<{ outputs?: Array<{ type: string; value?: string }> }> } })
        ?.execution?.transitions) ?? []
    const plaintexts: string[] = []
    for (const transition of transitions) {
      for (const output of transition.outputs ?? []) {
        if (!output.type.startsWith('record') || typeof output.value !== 'string') continue
        try {
          plaintexts.push(aleo.decryptRecord(viewKey, output.value))
        } catch {
          // not ours — skip
        }
      }
    }
    return plaintexts
  }

  const write = async (
    actor: DevnodeActor,
    program: string,
    fn: string,
    inputs: string[],
    label: string,
  ): Promise<string> => {
    const txId = await actor.walletClient.writeContract({ program, function: fn, inputs })
    await waitAccepted(actor, testClient, txId, label)
    return txId
  }

  // ── Freezelist: initialize (sets the empty-tree root) and grant the admin
  // the manager role, mirroring amm-v3 deploy-router-e2e.
  await write(admin, FREEZELIST_PROGRAM, 'initialize', [admin.account.address, '100u32'], 'freezelist initialize')
  await write(admin, FREEZELIST_PROGRAM, 'update_role', [admin.account.address, '24u16'], 'freezelist update_role')

  // ── Fee tier, tick spacing, and their binding.
  await write(admin, AMM_PROGRAM, 'add_fee_tier', [`${FEE}u16`], 'add_fee_tier')
  await write(admin, AMM_PROGRAM, 'add_tick_spacing', [`${TICK_SPACING}u32`], 'add_tick_spacing')
  await write(admin, AMM_PROGRAM, 'bind_fee_to_tick_spacing', [`${FEE}u16`, `${TICK_SPACING}u32`], 'bind_fee_to_tick_spacing')

  // ── Token metadata.
  const plainA = tokenInfo('test_token_a.aleo')
  const plainH = tokenInfo('fake_plainhitok.aleo')
  const wcredits = tokenInfo('fake_wcredits.aleo', { program: 'fake_credits.aleo', width: 'u64' })
  const wusdcx = tokenInfo('fake_wusdcx.aleo', { program: 'fake_usdcx.aleo', width: 'u128' })

  // ── Register tokens: plain tokens as (id, id); wrappers bind wrapper→underlying.
  const allowToken = async (token: TokenInfo) => {
    const underlyingField = token.wrapped ? programToTokenId(token.underlyingProgram!) : token.field
    await write(admin, AMM_PROGRAM, 'allow_token', [token.field, underlyingField], `allow_token ${token.program}`)
  }
  for (const token of [plainA, plainH, wcredits, wusdcx]) await allowToken(token)

  // ── Build the three pools, sorting each pair by field id.
  const makePool = async (name: string, a: TokenInfo, b: TokenInfo): Promise<PoolInfo> => {
    const [token0, token1] = fieldLt(a.field, b.field) ? [a, b] : [b, a]
    const { poolKey } = await adminDex.createPool({
      token0ProgramId: token0.field,
      token1ProgramId: token1.field,
      fee: FEE,
      initialTick: 0,
      imports,
    })
    if (!poolKey) throw new Error(`${name}: createPool returned no poolKey`)
    return { name, poolKey, token0, token1 }
  }
  const pp = await makePool('pp', plainA, plainH)
  const wp = await makePool('wp', wcredits, plainH)
  const ww = await makePool('ww', wcredits, wusdcx)

  // ── Record acquisition helpers.
  // Admin credits `actor`'s public balance (mint is admin-gated), then the
  // actor privatizes it into a Token record it owns.
  const mintPlainTo = async (actor: DevnodeActor, tokenProgram: string, amount: bigint): Promise<string> => {
    await write(admin, tokenProgram, 'mint_public', [actor.account.address, `${amount}u128`], `mint_public ${tokenProgram}`)
    const result = await actor.walletClient.executeContract({
      program: tokenProgram,
      function: 'transfer_public_to_private',
      inputs: [actor.account.address, `${amount}u128`],
    })
    const record = result.outputs.find((o) => o.includes('amount'))
    if (!record) throw new Error(`No Token record from ${tokenProgram} transfer_public_to_private`)
    return record
  }
  const mintPlainToUser = (tokenProgram: string, amount: bigint): Promise<string> => mintPlainTo(user, tokenProgram, amount)

  const mintUnderlyingToUser = async (
    underlyingProgram: string,
    amount: bigint,
    width: 'u64' | 'u128',
  ): Promise<string> => {
    // The fakes gate mint_private on the admin signer; the output record is
    // owned by the user, so recover it with the user's view key.
    const txId = await write(
      admin,
      underlyingProgram,
      'mint_private',
      [user.account.address, `${amount}${width}`],
      `mint_private ${underlyingProgram}`,
    )
    const records = await recordsOf(user.account.viewKey, txId)
    const record = records.find((r) => new RegExp(`amount:\\s*${amount}${width}`).test(r))
    if (!record) throw new Error(`No ${underlyingProgram} record of ${amount}${width} for the user`)
    return record
  }

  // ── Seed the plain pool with liquidity through the SDK mint so its swaps
  // have depth. The wrapped pools (wp, ww) are created here but seeded by the
  // wrapped-side suites themselves: their matrix mints a position through the
  // LP router before swapping, so each wrapped test provides its own depth via
  // the same router dispatch it exercises.
  const SEED = 200_000_000n
  {
    const record0 = await mintPlainTo(admin, pp.token0.program, SEED)
    const record1 = await mintPlainTo(admin, pp.token1.program, SEED)
    await adminDex.mint({
      poolKey: pp.poolKey,
      tickLower: -20 * TICK_SPACING,
      tickUpper: 20 * TICK_SPACING,
      amount0Desired: SEED / 2n,
      amount1Desired: SEED / 2n,
      recipient: admin.account.address,
      withdrawal: admin.account.address,
      token0Record: record0,
      token1Record: record1,
      proofs: devnodeProofProvider,
      imports,
    })
  }

  return {
    devnode,
    testClient,
    aleo,
    admin,
    user,
    imports,
    proofs: devnodeProofProvider,
    fee: FEE,
    tickSpacing: TICK_SPACING,
    tokens: { plainA, plainH, wcredits, wusdcx },
    pools: { pp, wp, ww },
    mintPlainToUser,
    mintUnderlyingToUser,
    recordsOf,
    stop: async () => {
      try {
        await testClient.shutdown()
      } catch {
        // devnode may already be down
      }
      try {
        await devnode.stop()
      } catch {
        // already stopped via shutdown
      }
    },
  }
}
