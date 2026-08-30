import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { startDevnode, type DevnodeInstance } from '@provablehq/veil-aleo-devnode'
import { createDevnodeClient, generateAccount, loadNetwork, type AleoSdk } from '@provablehq/veil-aleo-sdk'
import { createTestClient, http } from '@provablehq/veil-core'
import type { PublicClient, WalletClient, TestClient, LocalAccount } from '@provablehq/veil-core'
import { SealanceMerkleTree } from '@provablehq/sdk'

import { shieldSwapActions } from '../../src/decorators/shieldSwapActions.js'
import { programToTokenId } from '../../src/utils/routing.js'

/**
 * Devnode fixture that deploys the **deployed testnet bytecode** of the
 * `shield_swap.aleo` stack rather than compiling this repo's Leo sources.
 *
 * The network is the authoritative definition of these programs, so the
 * freezelist verifier this fixture exercises is byte-for-byte the one running
 * on testnet. Only the authority addresses are repointed — see
 * {@link repointAuthorities} — because the deployed constructors name
 * Provable's deployer, whose key no local chain holds.
 *
 * Requires network access on first run and `aleo-devnode` on PATH. Fetched
 * bytecode is cached under the OS temp directory, so later runs are offline.
 */

/** The AMM program id. */
export const AMM_PROGRAM = 'shield_swap.aleo'
/** The AMM's compliance freezelist. */
export const FREEZELIST_PROGRAM = 'shield_swap_freezelist.aleo'
/** Fee tier the fixture registers; the pool uses it. */
export const FEE = 3000
/** Tick spacing bound to {@link FEE}. */
export const TICK_SPACING = 60

/** Node the deployed bytecode is read from. */
const NETWORK_API = process.env.VEIL_NETWORK_API ?? 'https://api.provable.com/v2/testnet'

/**
 * Deployed programs to mirror onto the devnode, in dependency order.
 *
 * The two plain ARC-20s are the tokens the AMM settles against **directly** —
 * their `amm_token_program` equals their `underlying_program` in the DEX token
 * list, so neither needs the router that wrapped assets go through.
 */
const PROGRAMS = [
  'shield_swap_multisig_core.aleo',
  FREEZELIST_PROGRAM,
  AMM_PROGRAM,
  'test_arc20_multisig_core.aleo',
  'test_arc20_usdc.aleo',
  'test_arc20_eth.aleo',
] as const

/** Plain ARC-20s the fixture pools against each other. */
export const TOKEN_A = 'test_arc20_usdc.aleo'
export const TOKEN_B = 'test_arc20_eth.aleo'

/**
 * Authority addresses baked into the deployed bytecode, with the exact number
 * of occurrences each program is expected to carry.
 *
 * Asserting the counts turns an upstream redeploy that moves or adds an
 * authority into a loud failure here, rather than a devnode that silently
 * deploys a program nobody can drive.
 */
const AUTHORITIES: Record<string, ReadonlyArray<readonly [string, number]>> = {
  // constructor asserts `program_owner`; `initialize` asserts the caller.
  [FREEZELIST_PROGRAM]: [['aleo1z3zwzgpgakk89xpknync5rtklkjkyv33g7cvaqe0gku64zs3lv9qyux0qc', 2]],
  // constructor writes `admin[true]`.
  [AMM_PROGRAM]: [['aleo1z3zwzgpgakk89xpknync5rtklkjkyv33g7cvaqe0gku64zs3lv9qyux0qc', 1]],
  // both tokens gate minting on the same address.
  [TOKEN_A]: [['aleo1axurgcdhztu8m23ttzju38qzchtzs8kyk7nga9n58zyrmnxzmuqqf6wqdc', 1]],
  [TOKEN_B]: [['aleo1axurgcdhztu8m23ttzju38qzchtzs8kyk7nga9n58zyrmnxzmuqqf6wqdc', 1]],
}

const CACHE_DIR = join(tmpdir(), 'veil-network-programs')

/** True when the deployed bytecode is cached or the network is reachable. */
export function networkStackAvailable(): boolean {
  return process.env.VEIL_DEVNODE_INTEGRATION === '1'
}

/**
 * Reads a deployed program's bytecode, preferring the on-disk cache.
 *
 * The node returns the program as a JSON-encoded string, so the body is parsed
 * rather than used verbatim. Hits the network on a cache miss.
 */
async function fetchProgram(programId: string): Promise<string> {
  mkdirSync(CACHE_DIR, { recursive: true })
  const cached = join(CACHE_DIR, programId)
  if (existsSync(cached)) return readFileSync(cached, 'utf-8')

  const response = await fetch(`${NETWORK_API}/program/${programId}`)
  if (!response.ok) {
    throw new Error(`${programId}: ${NETWORK_API} answered HTTP ${response.status}`)
  }
  const source = (await response.json()) as string
  if (typeof source !== 'string' || !source.includes(`program ${programId}`)) {
    throw new Error(`${programId}: response did not carry the program source`)
  }
  writeFileSync(cached, source, 'utf-8')
  return source
}

/**
 * Repoints a deployed program's authority addresses at the devnode account.
 *
 * The deployed constructors name Provable's deployer — `shield_swap_freezelist`
 * asserts it as `program_owner`, `shield_swap` writes it into `admin`, and each
 * token gates minting on it — so a local chain can neither deploy nor drive the
 * stack unmodified. Substituting the address leaves every other instruction
 * untouched, including the whole Merkle verifier this fixture exists to
 * exercise.
 *
 * @param programId Program whose expected authorities are looked up.
 * @param source The deployed bytecode.
 * @param devnodeAddress Address to install as the authority.
 * @returns The bytecode with authorities repointed.
 * @throws When a program carries a different number of authority occurrences
 *   than expected, which means the deployed bytecode moved and this fixture's
 *   assumptions need rechecking.
 */
export function repointAuthorities(programId: string, source: string, devnodeAddress: string): string {
  const expected = AUTHORITIES[programId]
  if (!expected) return source

  let rewritten = source
  for (const [authority, count] of expected) {
    const found = rewritten.split(authority).length - 1
    if (found !== count) {
      throw new Error(
        `${programId}: expected ${count} occurrence(s) of ${authority} in the deployed bytecode, found ${found}`,
      )
    }
    rewritten = rewritten.split(authority).join(devnodeAddress)
  }
  return rewritten
}

export type DevnodeActor = {
  publicClient: PublicClient
  walletClient: WalletClient
  account: LocalAccount<'privateKey'>
}

export type NetworkStack = {
  devnode: DevnodeInstance
  testClient: TestClient
  aleo: AleoSdk
  admin: DevnodeActor
  user: DevnodeActor
  /** Program id → deployed source, for the wasm's dynamic-dispatch resolution. */
  imports: Record<string, string>
  poolKey: string
  /** Pool sides, sorted by token id as the AMM stores them. */
  token0: { program: string; field: string }
  token1: { program: string; field: string }
  fee: number
  tickSpacing: number
  /** Mints a plain token to an actor and privatizes it into a spendable record. */
  mintTokenTo: (actor: DevnodeActor, tokenProgram: string, amount: bigint) => Promise<string>
  /** Reads a mapping value, or null when the key is absent. */
  readMapping: (programId: string, mapping: string, key: string) => Promise<string | null>
  /** Freezes addresses in order, returning the resulting tree as the API serves it. */
  freezeAddresses: (addresses: string[]) => Promise<string[]>
  stop: () => Promise<void>
}

/** Numeric compare of two `field` literals. */
function fieldLt(a: string, b: string): boolean {
  return BigInt(a.replace(/field$/, '')) < BigInt(b.replace(/field$/, ''))
}

/** Builds the flat tree for a set of frozen addresses, as the API would serve it. */
export function freezeListTree(addresses: string[]): string[] {
  const sealance = new SealanceMerkleTree()
  const leaves = sealance.generateLeaves(addresses, 16)
  return sealance.buildTree(leaves).map(String)
}

/** Boots a devnode running the deployed stack, bootstrapped and pooled. */
export async function setupNetworkStack(): Promise<NetworkStack> {
  const devnode = await startDevnode({
    readyTimeout: 60_000,
    verbose: process.env.VEIL_DEVNODE_VERBOSE === '1',
  })
  const testClient = createTestClient({
    transport: http(`http://${devnode.socketAddr}`, { network: 'testnet' }),
  })
  const aleo = await loadNetwork('testnet')

  const adminPair = createDevnodeClient({ socketAddr: devnode.socketAddr })
  const admin: DevnodeActor = {
    publicClient: adminPair.publicClient,
    walletClient: adminPair.walletClient,
    account: adminPair.account,
  }

  // Pull the deployed bytecode and repoint its authorities at this chain's
  // funded genesis account, which is the only key the devnode holds.
  const sources: Record<string, string> = {}
  for (const programId of PROGRAMS) {
    sources[programId] = repointAuthorities(
      programId,
      await fetchProgram(programId),
      admin.account.address,
    )
  }

  await testClient.advanceBlock({ count: 1 })

  const waitAccepted = async (actor: DevnodeActor, txId: string, label: string) => {
    await testClient.advanceBlock({ count: 1 })
    const { status } = await actor.walletClient.transactionStatus({ transactionId: txId })
    if (status !== 'accepted') throw new Error(`${label}: transaction ${txId} is ${status}`)
  }

  // Deployment acceptance and queryability are not atomic, and the wasm
  // resolves a program's imports from the node while building the next deploy.
  const waitQueryable = async (programId: string) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const source = await admin.publicClient.getCode({ programId })
        if (source.includes(`program ${programId}`)) return
      } catch {
        // not served yet
      }
      await testClient.advanceBlock({ count: 1 })
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error(`${programId} never became queryable on the devnode`)
  }

  for (const programId of PROGRAMS) {
    const txId = await admin.walletClient.deployContract({ program: sources[programId]! })
    await waitAccepted(admin, txId, `deploy ${programId}`)
    await waitQueryable(programId)
  }

  const imports: Record<string, string> = { ...sources }

  const userAccount = generateAccount()
  const userPair = createDevnodeClient({ privateKey: userAccount.privateKey, socketAddr: devnode.socketAddr })
  const user: DevnodeActor = {
    publicClient: userPair.publicClient,
    walletClient: userPair.walletClient,
    account: userPair.account,
  }

  const write = async (actor: DevnodeActor, program: string, fn: string, inputs: string[], label: string) => {
    const txId = await actor.walletClient.writeContract({ program, function: fn, inputs })
    await waitAccepted(actor, txId, label)
    return txId
  }

  await write(admin, 'credits.aleo', 'transfer_public', [user.account.address, '1000000000u64'], 'fund user')

  const readMapping = async (programId: string, mapping: string, key: string): Promise<string | null> =>
    (await admin.publicClient.request({
      method: 'getMappingValue',
      params: { programId, mapping, key },
    })) as string | null

  // ── Freezelist: initialize writes the empty-tree root; role 24 grants the
  // admin both the manager and updater bits `update_freeze_list` asserts.
  await write(admin, FREEZELIST_PROGRAM, 'initialize', [admin.account.address, '100u32'], 'freezelist initialize')
  await write(admin, FREEZELIST_PROGRAM, 'update_role', [admin.account.address, '24u16'], 'freezelist update_role')

  // ── Fee tier, tick spacing, binding, and token registration.
  await write(admin, AMM_PROGRAM, 'add_fee_tier', [`${FEE}u16`], 'add_fee_tier')
  await write(admin, AMM_PROGRAM, 'add_tick_spacing', [`${TICK_SPACING}u32`], 'add_tick_spacing')
  await write(admin, AMM_PROGRAM, 'bind_fee_to_tick_spacing', [`${FEE}u16`, `${TICK_SPACING}u32`], 'bind_fee')

  const tokenA = { program: TOKEN_A, field: programToTokenId(TOKEN_A) }
  const tokenB = { program: TOKEN_B, field: programToTokenId(TOKEN_B) }
  for (const token of [tokenA, tokenB]) {
    // Each token starts with an empty role table, and `mint_public` reads the
    // caller's role with a bare `get` — so an unroled admin is rejected, not
    // defaulted. `initialize_token` seeds the admin bit (8); role 9 adds the
    // mint bit (1) while keeping the admin bit `update_role` requires a caller
    // to retain when it rewrites its own entry.
    await write(admin, token.program, 'initialize_token', [admin.account.address], `init ${token.program}`)
    await write(admin, token.program, 'update_role', [admin.account.address, '9u16'], `role ${token.program}`)
    // Plain tokens register as (id, id) — no wrapper indirection.
    await write(admin, AMM_PROGRAM, 'allow_token', [token.field, token.field], `allow_token ${token.program}`)
  }

  const [token0, token1] = fieldLt(tokenA.field, tokenB.field) ? [tokenA, tokenB] : [tokenB, tokenA]

  const adminDex = admin.walletClient.extend(shieldSwapActions({ program: AMM_PROGRAM })) as ReturnType<
    ReturnType<typeof shieldSwapActions>
  >
  const { poolKey } = await adminDex.createPool({
    token0ProgramId: token0.field,
    token1ProgramId: token1.field,
    fee: FEE,
    initialTick: 0,
    imports,
  })
  if (!poolKey) throw new Error('createPool returned no poolKey')

  const mintTokenTo = async (actor: DevnodeActor, tokenProgram: string, amount: bigint): Promise<string> => {
    await write(admin, tokenProgram, 'mint_public', [actor.account.address, `${amount}u128`], `mint ${tokenProgram}`)
    const result = await actor.walletClient.executeContract({
      program: tokenProgram,
      function: 'transfer_public_to_private',
      inputs: [actor.account.address, `${amount}u128`],
    })
    const record = result.outputs.find((output) => output.includes('amount'))
    if (!record) throw new Error(`No token record from ${tokenProgram} transfer_public_to_private`)
    return record
  }

  /**
   * Freezes each address in turn, recomputing the root client-side.
   *
   * `update_freeze_list` asserts the supplied old root equals the stored one and
   * that the new root differs, so the roots must be rebuilt after every entry.
   * Indices are assigned from 1 upward because the contract rejects index 0 and
   * requires each new index to be at most `last_index + 1`.
   */
  const freezeAddresses = async (addresses: string[]): Promise<string[]> => {
    const frozen: string[] = []
    let currentRoot = await readMapping(FREEZELIST_PROGRAM, 'freeze_list_root', '1u8')
    if (!currentRoot) throw new Error('freezelist has no root — initialize did not run')

    for (const [index, address] of addresses.entries()) {
      frozen.push(address)
      const tree = freezeListTree(frozen)
      const nextRoot = `${tree[tree.length - 1]}field`
      await write(
        admin,
        FREEZELIST_PROGRAM,
        'update_freeze_list',
        [address, 'true', `${index + 1}u32`, currentRoot, nextRoot],
        `freeze ${address}`,
      )
      currentRoot = nextRoot
    }
    return freezeListTree(frozen)
  }

  return {
    devnode,
    testClient,
    aleo,
    admin,
    user,
    imports,
    poolKey,
    token0,
    token1,
    fee: FEE,
    tickSpacing: TICK_SPACING,
    mintTokenTo,
    readMapping,
    freezeAddresses,
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
