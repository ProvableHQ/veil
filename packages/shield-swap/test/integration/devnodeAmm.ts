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
import type { ProofProvider } from '../../src/utils/proofs.js'
import { EMPTY_MERKLE_PROOFS } from '../../src/utils/proofs.js'
import {
  CANONICAL_PROGRAM_SPECS,
  CREDITS_WRAPPER_PROGRAM,
  USDCX_FREEZELIST_PROGRAM,
  USDCX_STABLECOIN_PROGRAM,
  USDCX_WRAPPER_PROGRAM,
  loadCanonicalProgramForDevnode,
  replaceExactOccurrences,
  validateProgramSource,
} from '../fixtures/canonical/canonicalPrograms.js'

/**
 * Devnode fixture for the `shield_swap.aleo` stack.
 *
 * Builds the AMM, its multisig/freezelist imports, both routers, and two plain
 * ARC-20 test tokens from the amm-v3 Leo sources, deploys the pinned canonical
 * wrapper and stablecoin bytecode alongside them (see
 * `test/fixtures/canonical/canonicalPrograms.ts`), then bootstraps the USDCx
 * stack, fee tiers, tick spacings, token registration, three pools
 * (plain/plain, wrapped/plain, wrapped/wrapped), and router-seeded liquidity.
 * The two lifecycle suites drive SDK actions and the generated contract through
 * this fixture.
 *
 * The devnode operator deploys everything and holds every admin role: the AMM's
 * baked deployer is rewritten to it, the canonical programs' embedded testnet
 * owners are substituted for it, and the plain test tokens already bake it as
 * their mint admin.
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

// Program id → project directory, for the programs built from Leo source.
// test_token_a and test_token_b are amm-v3's standalone plain ARC-20 test
// tokens: two distinct plain sides for the plain/plain pool, and the plain side
// of the wrapped/plain pool.
const LOCAL_PROGRAMS: ReadonlyArray<readonly [string, string]> = [
  ['shield_swap_multisig_core.aleo', join(AMM_V3_ROOT, 'shield_swap_multisig_core')],
  ['shield_swap_freezelist.aleo', join(AMM_V3_ROOT, 'shield_swap_freezelist')],
  ['shield_swap.aleo', AMM_V3_ROOT],
  ['test_token_a.aleo', join(AMM_V3_ROOT, 'token-wrappers', 'test_token_a')],
  ['test_token_b.aleo', join(AMM_V3_ROOT, 'token-wrappers', 'test_token_b')],
  ['shield_swap_router.aleo', join(AMM_V3_ROOT, 'shield_swap_router')],
  ['shield_swap_lp_router.aleo', join(AMM_V3_ROOT, 'shield_swap_lp_router')],
  ['shield_swap_rebalance_router.aleo', join(AMM_V3_ROOT, 'shield_swap_rebalance_router')],
]

const CANONICAL_PROGRAM_IDS: readonly string[] = CANONICAL_PROGRAM_SPECS.map((spec) => spec.id)

// Deploy order: every program's imports precede it. Derived from LOCAL_PROGRAMS
// so a program added there cannot be compiled but left undeployed, with the
// canonical set spliced in right after the AMM — the wrappers import the AMM's
// multisig core, and both routers dispatch to the wrappers at run time.
const DEPLOY_ORDER: readonly string[] = LOCAL_PROGRAMS.flatMap(([programId]) =>
  programId === AMM_PROGRAM ? [programId, ...CANONICAL_PROGRAM_IDS] : [programId],
)

if (DEPLOY_ORDER.length !== LOCAL_PROGRAMS.length + CANONICAL_PROGRAM_IDS.length) {
  throw new Error(
    `LOCAL_PROGRAMS must name ${AMM_PROGRAM} exactly once — it is the splice point for the canonical programs`,
  )
}

const FREEZELIST_PROGRAM = 'shield_swap_freezelist.aleo'

// The AMM bakes its testnet deployer as the address its constructor writes into
// admin[true]; on a devnode that address controls nothing, so the fixture
// rewrites it to the devnode operator.
const AMM_TESTNET_DEPLOYER = 'aleo1z3zwzgpgakk89xpknync5rtklkjkyv33g7cvaqe0gku64zs3lv9qyux0qc'

// USDCx stack bootstrap constants, mirroring amm-v3's devnode setup.
/** The `name`/`symbol` u128 literal the canonical USDCx deployment initializes with. */
const USDCX_NAME_AND_SYMBOL = '366469202808u128'
const MAX_U128 = '340282366920938463463374607431768211455u128'
/** Role bits 8 (admin) | 1 (minter) on the stablecoin. */
const USDCX_ADMIN_MINTER_ROLE = '9u16'
/** Blocks the USDCx freezelist keeps accepting the previous root for. */
const USDCX_FREEZELIST_BLOCK_WINDOW = '100u32'
/** Manager role on the AMM's own freezelist. */
const AMM_FREEZELIST_MANAGER_ROLE = '24u16'

/**
 * Non-inclusion witnesses for the devnode.
 *
 * Every freezelist in the stack — the AMM's own and the canonical USDCx
 * stablecoin's — is initialized empty and stays empty, and both accept the
 * canonical empty-tree witness against that root. The credits wrapper takes the
 * proof argument and ignores it. Passing this provider (rather than omitting
 * one) keeps the actions suite exercising the SDK's provider plumbing.
 */
export const devnodeProofProvider: ProofProvider = async () => EMPTY_MERKLE_PROOFS

export type DevnodeActor = {
  publicClient: PublicClient
  walletClient: WalletClient
  account: LocalAccount<'privateKey'>
}

/** A token this fixture deploys, with its AMM-facing id and record particulars. */
export type TokenInfo = {
  /** Program id (e.g. `shield_swap_arc20_credits.aleo`). */
  program: string
  /** AMM token id as a `field` literal. */
  field: string
  /** True when the token is a router-mediated wrapper. */
  wrapped: boolean
  /** Underlying program id whose records the user spends (wrapped tokens only). */
  underlyingProgram?: string
  /** Bit-width of the underlying record's amount (`u64` credits, `u128` others). */
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
  /** Freezelist non-inclusion provider (empty-tree). Pass to every routed call. */
  proofs: ProofProvider
  fee: number
  tickSpacing: number
  tokens: {
    plainA: TokenInfo
    plainB: TokenInfo
    wcredits: TokenInfo
    wusdcx: TokenInfo
  }
  pools: {
    /** plain / plain: test_token_a + test_token_b. */
    pp: PoolInfo
    /** wrapped / plain: the credits wrapper + test_token_b. */
    wp: PoolInfo
    /** wrapped / wrapped: the credits wrapper + the wrapped-USDCx wrapper. */
    ww: PoolInfo
  }
  /**
   * Mints a plain token to the user and privatizes it, returning the user-owned
   * Token record plaintext.
   */
  mintPlainToUser: (tokenProgram: string, amount: bigint) => Promise<string>
  /**
   * Gives the user a private record of a wrapped token's underlying asset,
   * returning the user-owned record plaintext.
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

/**
 * Rewrites the AMM's baked deployer to the devnode operator.
 *
 * The constructor writes that address into `admin[true]` at edition 0, and the
 * whole bootstrap (fee tiers, token registration, pool creation) is
 * admin-gated. Accepts a source that already names the devnode operator, so a
 * development tree whose constant is already local passes through unchanged.
 *
 * @param source The compiled `shield_swap.aleo` instructions.
 * @param deployerAddress The devnode operator to install as admin.
 * @returns The rewritten instructions, re-parsed to confirm they still declare
 *   the AMM.
 * @throws When neither form of the admin write appears exactly once, or when the
 *   rewrite no longer parses as `shield_swap.aleo`.
 */
function deriveDevnodeShieldSwapSource(source: string, deployerAddress: string): string {
  const testnetWrite = `set ${AMM_TESTNET_DEPLOYER} into admin[true];`
  const devnodeWrite = `set ${deployerAddress} into admin[true];`
  const derived = replaceExactOccurrences(
    source,
    source.includes(testnetWrite) ? testnetWrite : devnodeWrite,
    devnodeWrite,
    1,
    `${AMM_PROGRAM} devnode deployer adaptation`,
  )
  validateProgramSource(AMM_PROGRAM, derived)
  return derived
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

  // Compile every locally sourced program up front (one-time, ~15s cold).
  const sources: Record<string, string> = {}
  for (const [programId, projectDir] of LOCAL_PROGRAMS) {
    sources[programId] = buildProgram(programId, projectDir)
  }

  const devnode = await startDevnode({ readyTimeout: 60_000, verbose: process.env.VEIL_DEVNODE_VERBOSE === '1' })
  const testClient = createTestClient({
    transport: http(`http://${devnode.socketAddr}`, { network: 'testnet' }),
  })
  const aleo = await loadNetwork('testnet')

  // The devnode genesis account deploys everything, so it owns every canonical
  // program and is the mint/admin authority the adaptations install.
  const adminPair = createDevnodeClient({ socketAddr: devnode.socketAddr })
  const admin: DevnodeActor = {
    publicClient: adminPair.publicClient,
    walletClient: adminPair.walletClient,
    account: adminPair.account,
  }

  // Adapt the deployer-dependent sources now that the operator is known.
  sources[AMM_PROGRAM] = deriveDevnodeShieldSwapSource(sources[AMM_PROGRAM]!, admin.account.address)
  for (const spec of CANONICAL_PROGRAM_SPECS) {
    sources[spec.id] = loadCanonicalProgramForDevnode(spec, admin.account.address)
  }

  await testClient.advanceBlock({ count: 1 })

  for (const programId of DEPLOY_ORDER) {
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

  // Fund the user's public credits balance: it pays transaction fees AND backs
  // the credits wrapper, whose deposits spend private credits records the user
  // privatizes out of this balance.
  const fundTx = await admin.walletClient.writeContract({
    program: 'credits.aleo',
    function: 'transfer_public',
    inputs: [user.account.address, '100000000000u64'],
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

  // ── AMM freezelist: initialize (sets the empty-tree root) and grant the admin
  // the manager role, mirroring amm-v3 deploy-router-e2e.
  await write(admin, FREEZELIST_PROGRAM, 'initialize', [admin.account.address, '100u32'], 'freezelist initialize')
  await write(
    admin,
    FREEZELIST_PROGRAM,
    'update_role',
    [admin.account.address, AMM_FREEZELIST_MANAGER_ROLE],
    'freezelist update_role',
  )

  // ── USDCx stack: its freezelist starts empty (the root the empty-tree witness
  // proves against), the stablecoin takes its token metadata, and the operator
  // takes the admin|minter role that lets it mint the wrapper's underlying
  // asset. Mirrors amm-v3's initializeDevnodeUsdcxStack.
  await write(
    admin,
    USDCX_FREEZELIST_PROGRAM,
    'initialize',
    [admin.account.address, USDCX_FREEZELIST_BLOCK_WINDOW],
    'usdcx freezelist initialize',
  )
  await write(
    admin,
    USDCX_STABLECOIN_PROGRAM,
    'initialize',
    [USDCX_NAME_AND_SYMBOL, USDCX_NAME_AND_SYMBOL, '6u8', MAX_U128, admin.account.address],
    'usdcx initialize',
  )
  await write(
    admin,
    USDCX_STABLECOIN_PROGRAM,
    'update_role',
    [admin.account.address, USDCX_ADMIN_MINTER_ROLE],
    'usdcx update_role',
  )

  // ── Fee tier, tick spacing, and their binding.
  await write(admin, AMM_PROGRAM, 'add_fee_tier', [`${FEE}u16`], 'add_fee_tier')
  await write(admin, AMM_PROGRAM, 'add_tick_spacing', [`${TICK_SPACING}u32`], 'add_tick_spacing')
  await write(admin, AMM_PROGRAM, 'bind_fee_to_tick_spacing', [`${FEE}u16`, `${TICK_SPACING}u32`], 'bind_fee_to_tick_spacing')

  // ── Token metadata.
  const plainA = tokenInfo('test_token_a.aleo')
  const plainB = tokenInfo('test_token_b.aleo')
  const wcredits = tokenInfo(CREDITS_WRAPPER_PROGRAM, { program: 'credits.aleo', width: 'u64' })
  const wusdcx = tokenInfo(USDCX_WRAPPER_PROGRAM, { program: USDCX_STABLECOIN_PROGRAM, width: 'u128' })

  // ── Register tokens: plain tokens as (id, id); wrappers bind wrapper→underlying.
  const allowToken = async (token: TokenInfo) => {
    const underlyingField = token.wrapped ? programToTokenId(token.underlyingProgram!) : token.field
    await write(admin, AMM_PROGRAM, 'allow_token', [token.field, underlyingField], `allow_token ${token.program}`)
  }
  for (const token of [plainA, plainB, wcredits, wusdcx]) await allowToken(token)

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
  const pp = await makePool('pp', plainA, plainB)
  const wp = await makePool('wp', wcredits, plainB)
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

  // A wrapped side spends records of its UNDERLYING asset. Native credits come
  // from the user's own public balance; the canonical stablecoin is minted
  // straight to the user as a private record by the admin|minter operator.
  const mintUnderlyingToUser = async (
    underlyingProgram: string,
    amount: bigint,
    width: 'u64' | 'u128',
  ): Promise<string> => {
    if (underlyingProgram === 'credits.aleo') {
      const result = await user.walletClient.executeContract({
        program: 'credits.aleo',
        function: 'transfer_public_to_private',
        inputs: [user.account.address, `${amount}${width}`],
      })
      const record = result.outputs.find((o) => o.includes('microcredits'))
      if (!record) throw new Error(`No credits record from transfer_public_to_private of ${amount}${width}`)
      return record
    }

    // mint_private is minter-gated, so the admin signs it; the Token record it
    // outputs is owned by the user, and the co-output compliance record is
    // encrypted to the stablecoin's investigator key (so it never decrypts here).
    const txId = await write(
      admin,
      underlyingProgram,
      'mint_private',
      [user.account.address, `${amount}${width}`],
      `mint_private ${underlyingProgram}`,
    )
    const records = await recordsOf(user.account.viewKey, txId)
    const record = records.find((r) => new RegExp(`amount:\\s*${amount}${width}`).test(r))
    if (!record) throw new Error(`No ${underlyingProgram} record of ${amount}${width} for ${user.account.address}`)
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
    tokens: { plainA, plainB, wcredits, wusdcx },
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
