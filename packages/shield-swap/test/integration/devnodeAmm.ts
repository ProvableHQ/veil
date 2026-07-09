import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { startDevnode, type DevnodeInstance } from '@veil/devnode'
import { createDevnodeClient, loadNetwork, generateAccount, type AleoSdk } from '@veil/provable-sdk'
import { createTestClient, http } from '@veil/core'
import type { PublicClient, WalletClient, TestClient, LocalAccount, ConfirmedTransaction } from '@veil/core'

import { buildLeoProgram } from '../../../provable-sdk/test/integration/leoProject.js'
import { createShieldSwapV3Contract } from '../../src/generated/shield_swap.js'

/**
 * Shared devnode fixture for the AMM lifecycle e2e suites: deploys the
 * vendored shield_swap_v3.aleo (and its multisig import) with the baked admin
 * patched to the devnode account, alongside two locally-built ARC-20 test
 * tokens, runs the admin configuration through the generated contract, and
 * funds a non-admin user for the lifecycle calls. Fully hermetic — no live
 * network. Refresh the vendored AMM sources with
 * codegen/refresh-devnode-fixtures.sh when the deployed contract changes.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, '../fixtures/programs')

export const AMM_PROGRAM = 'shield_swap_v3.aleo'
export const MULTISIG_PROGRAM = 'test_shield_swap_multisig_core.aleo'
export const TOKEN_A = 'test_token_a.aleo'
export const TOKEN_B = 'test_token_b.aleo'

/** One million tokens at 6 decimals — the per-user provisioning amount. */
export const TOKEN_SUPPLY = 1_000_000_000_000n

export type DevnodeActor = {
  publicClient: PublicClient
  walletClient: WalletClient
  account: LocalAccount<'privateKey'>
}

export type AmmDevnode = {
  devnode: DevnodeInstance
  testClient: TestClient
  aleo: AleoSdk
  admin: DevnodeActor
  user: DevnodeActor
  /** Program id → source, for the AMM's dynamic-dispatch import resolution. */
  imports: Record<string, string>
  /** Field literals for the two token programs, ascending — pool token order. */
  token0Field: string
  token1Field: string
  /** Program id of the token whose field id sorts lower/higher. */
  token0Program: string
  token1Program: string
  /** Decrypts the caller-owned records of a confirmed transaction. */
  recordsOf: (viewKey: string, txId: string) => Promise<string[]>
  stop: () => Promise<void>
}

/** Encodes a program identifier (no `.aleo`) the way the AMM keys tokens: LE bytes as a field. */
export function identifierToField(identifier: string): string {
  const bytes = new TextEncoder().encode(identifier)
  let value = 0n
  for (let i = bytes.length - 1; i >= 0; i--) {
    value = (value << 8n) | BigInt(bytes[i]!)
  }
  return `${value}field`
}

/** Reads a vendored program fixture. */
function readFixture(fileName: string): string {
  return readFileSync(join(FIXTURES, fileName), 'utf-8')
}

/**
 * Rewrites the baked deployer/admin address in the fetched AMM source to
 * `adminAddress`. The constructor promotes that literal to the `admin`
 * mapping at edition 0, so this is what makes the devnode account admin.
 */
export function patchAdminAddress(source: string, adminAddress: string): string {
  const constructorBlock = source.slice(source.indexOf('constructor:'))
  const baked = constructorBlock.match(/aleo1[a-z0-9]{58}/)?.[0]
  if (!baked) throw new Error('No admin address literal found in the AMM constructor')
  return source.replaceAll(baked, adminAddress)
}

async function waitAccepted(actor: DevnodeActor, testClient: TestClient, txId: string, label: string) {
  await testClient.advanceBlock({ count: 1 })
  const { status } = await actor.walletClient.transactionStatus({ transactionId: txId })
  if (status !== 'accepted') throw new Error(`${label}: transaction ${txId} is ${status}`)
}

/**
 * Waits until the devnode serves a deployed program's source. Acceptance and
 * queryability are not atomic on the devnode, and the wasm resolves a
 * program's imports from the node while building the next deployment.
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

/** Boots a devnode with the full AMM stack deployed, configured, and funded. */
export async function setupAmmDevnode(): Promise<AmmDevnode> {
  // Compile the two ARC-20 test tokens from the vendored sources.
  const tokenASource = readFileSync(join(HERE, '../fixtures/programs/test_token_a.leo'), 'utf-8')
  const tokenBSource = readFileSync(join(HERE, '../fixtures/programs/test_token_b.leo'), 'utf-8')
  const [builtA, builtB] = [
    await buildLeoProgram(TOKEN_A, tokenASource),
    await buildLeoProgram(TOKEN_B, tokenBSource),
  ]

  // The AMM and its multisig import are vendored; the ARC-20 tokens compile
  // from vendored Leo sources above.
  const multisigSource = readFixture(MULTISIG_PROGRAM)
  const ammSourceRaw = readFixture(AMM_PROGRAM)

  const devnode = await startDevnode({ readyTimeout: 45_000, verbose: process.env.VEIL_DEVNODE_VERBOSE === '1' })
  const testClient = createTestClient({
    transport: http(`http://${devnode.socketAddr}`, { network: 'testnet' }),
  })
  const aleo = await loadNetwork('testnet')
  const adminPair = createDevnodeClient()
  const admin: DevnodeActor = { publicClient: adminPair.publicClient, walletClient: adminPair.walletClient, account: adminPair.account }

  // credits.aleo ships with every node — read it from the devnode rather than
  // vendoring it (the AMM dynamically dispatches into it).
  const creditsSource = await admin.publicClient.getCode({ programId: 'credits.aleo' })

  const ammSource = patchAdminAddress(ammSourceRaw, admin.account.address)

  await testClient.advanceBlock({ count: 1 })

  // Deploy in dependency order; the AMM statically imports the multisig core.
  for (const [label, program] of [
    [MULTISIG_PROGRAM, multisigSource],
    [AMM_PROGRAM, ammSource],
    [TOKEN_A, builtA.compiled],
    [TOKEN_B, builtB.compiled],
  ] as const) {
    const txId = await admin.walletClient.deployContract({ program })
    await waitAccepted(admin, testClient, txId, `deploy ${label}`)
    await waitQueryable(admin, testClient, label)
  }

  // Every AMM write rebuilds the program in the wasm process, which needs the
  // full import closure: the static multisig import plus the dynamically
  // dispatched ARC-20 token sources (and their own credits.aleo import).
  const imports: Record<string, string> = {
    [MULTISIG_PROGRAM]: multisigSource,
    [TOKEN_A]: builtA.compiled,
    [TOKEN_B]: builtB.compiled,
    ['credits.aleo']: creditsSource,
  }

  // Pool token order is ascending by field id.
  const aField = identifierToField('test_token_a')
  const bField = identifierToField('test_token_b')
  const aFirst = BigInt(aField.replace('field', '')) < BigInt(bField.replace('field', ''))

  // Admin configuration through the generated contract: fee tiers, tick
  // spacings, canonical bindings, token registration, open pool creation.
  const adminContract = createShieldSwapV3Contract({
    publicClient: admin.publicClient,
    walletClient: admin.walletClient,
    imports,
  }) as any
  const adminSteps: Array<[string, () => Promise<{ transactionId: string }>]> = [
    ['add_fee_tier 3000', () => adminContract.execute.add_fee_tier({ arg0: '3000u16' })],
    ['add_fee_tier 500', () => adminContract.execute.add_fee_tier({ arg0: '500u16' })],
    ['add_tick_spacing 60', () => adminContract.execute.add_tick_spacing({ arg0: '60u32' })],
    ['add_tick_spacing 10', () => adminContract.execute.add_tick_spacing({ arg0: '10u32' })],
    ['bind 3000→60', () => adminContract.execute.bind_fee_to_tick_spacing({ arg0: '3000u16', arg1: '60u32' })],
    ['bind 500→10', () => adminContract.execute.bind_fee_to_tick_spacing({ arg0: '500u16', arg1: '10u32' })],
    ['decimals A', () => adminContract.execute.set_token_decimals({ arg0: aField, arg1: '6u8' })],
    ['decimals B', () => adminContract.execute.set_token_decimals({ arg0: bField, arg1: '6u8' })],
    ['allow A', () => adminContract.execute.allow_token({ arg0: aField })],
    ['allow B', () => adminContract.execute.allow_token({ arg0: bField })],
    ['open pool creation', () => adminContract.execute.set_pool_creation_is_open({ arg0: 'true' })],
  ]
  for (const [label, step] of adminSteps) {
    const { transactionId } = await step()
    const { status } = await admin.walletClient.transactionStatus({ transactionId })
    if (status !== 'accepted') throw new Error(`admin ${label}: ${status}`)
  }

  // A non-admin user proves the open-pool-creation gate: fund fees from the
  // seeded account, mint both tokens to it.
  const userAccount = generateAccount()
  const userPair = createDevnodeClient({ privateKey: userAccount.privateKey })
  const user: DevnodeActor = { publicClient: userPair.publicClient, walletClient: userPair.walletClient, account: userPair.account }

  const fundTx = await admin.walletClient.writeContract({
    program: 'credits.aleo',
    function: 'transfer_public',
    inputs: [user.account.address, '100000000u64'],
  })
  await waitAccepted(admin, testClient, fundTx, 'fund user')
  for (const token of [TOKEN_A, TOKEN_B]) {
    const mintTx = await admin.walletClient.writeContract({
      program: token,
      function: 'mint_public',
      inputs: [user.account.address, `${TOKEN_SUPPLY}u128`],
    })
    await waitAccepted(admin, testClient, mintTx, `mint ${token}`)
  }

  // Decrypts the records of a confirmed transaction that the given view key
  // owns — how the suites recover PositionNFTs and token change records the
  // write actions do not return.
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
        // Dynamic dispatch yields record_with_dynamic_id / record_dynamic
        // output variants alongside plain record outputs.
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

  return {
    devnode,
    testClient,
    aleo,
    admin,
    user,
    imports,
    token0Field: aFirst ? aField : bField,
    token1Field: aFirst ? bField : aField,
    token0Program: aFirst ? TOKEN_A : TOKEN_B,
    token1Program: aFirst ? TOKEN_B : TOKEN_A,
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

/**
 * Privatizes `amount` of `tokenProgram` for the actor: transfer_public_to_private
 * through the actor's own client, returning the decrypted Token record plaintext.
 */
export async function privatizeToken(
  actor: DevnodeActor,
  tokenProgram: string,
  amount: bigint,
): Promise<string> {
  const result = await actor.walletClient.executeContract({
    program: tokenProgram,
    function: 'transfer_public_to_private',
    inputs: [actor.account.address, `${amount}u128`],
  })
  const record = result.outputs.find((o) => o.includes('amount'))
  if (!record) throw new Error(`No Token record in transfer_public_to_private outputs: ${JSON.stringify(result.outputs)}`)
  return record
}
