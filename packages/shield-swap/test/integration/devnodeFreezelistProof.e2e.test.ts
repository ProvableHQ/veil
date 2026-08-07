import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildExclusionProof, FrozenAddressError, generateAccount } from '@provablehq/veil-aleo-sdk'

import { shieldSwapActions } from '../../src/decorators/shieldSwapActions.js'
import type { ProofProvider } from '../../src/utils/proofs.js'
import {
  setupNetworkStack,
  networkStackAvailable,
  freezeListTree,
  repointAuthorities,
  AMM_PROGRAM,
  FREEZELIST_PROGRAM,
  type NetworkStack,
} from './devnodeNetworkStack.js'

/**
 * Proves a Merkle exclusion witness against a **populated** freezelist, on a
 * devnode running the deployed testnet bytecode.
 *
 * Every other devnode suite mints against an empty list, where the canonical
 * all-zero witness is accepted. This one freezes real addresses first, so the
 * tree has depth and the witness carries a genuine sibling path — the only way
 * to show that `buildExclusionProof` agrees with the verifier the network runs.
 *
 * Gated behind VEIL_DEVNODE_INTEGRATION=1; requires aleo-devnode on PATH and,
 * on a cold cache, network access to read the deployed programs.
 *
 * Run with:
 *   VEIL_DEVNODE_INTEGRATION=1 npx vitest run \
 *     packages/shield-swap/test/integration/devnodeFreezelistProof.e2e.test.ts
 */

const RUN = networkStackAvailable()
const MINT = 10_000_000n

describe.runIf(RUN)('e2e: freezelist exclusion proofs against deployed bytecode', () => {
  let ctx: NetworkStack
  /** The freezelist tree after the addresses below are frozen. */
  let tree: string[]
  /** Addresses put on the list, none of which is the minting user. */
  let frozen: string[]

  beforeAll(async () => {
    ctx = await setupNetworkStack()

    // Five frozen addresses pad to eight leaves, giving depth 3. Depth matters:
    // at depth 2 the verifier's climb loop runs a single iteration, so the
    // node-layer hashing and the index-bit ordering above level one go
    // untested. Depth 3 runs it twice.
    frozen = Array.from({ length: 5 }, () => generateAccount().address)
    tree = await ctx.freezeAddresses(frozen)
  }, 900_000)

  afterAll(async () => {
    await ctx?.stop()
  })

  it('records the client-computed root on chain', async () => {
    const onChain = await ctx.readMapping(FREEZELIST_PROGRAM, 'freeze_list_root', '1u8')

    expect(onChain).toBe(`${tree[tree.length - 1]}field`)
    // Five addresses pad to eight leaves, so the flat tree is 2n - 1 = 15.
    expect(tree).toHaveLength(15)
  })

  it('tracks every frozen address in the contract index', async () => {
    const last = await ctx.readMapping(FREEZELIST_PROGRAM, 'freeze_list_last_index', 'true')
    expect(last).toBe(`${frozen.length}u32`)

    for (const [index, address] of frozen.entries()) {
      expect(await ctx.readMapping(FREEZELIST_PROGRAM, 'freeze_list_index', `${index + 1}u32`)).toBe(address)
      expect(await ctx.readMapping(FREEZELIST_PROGRAM, 'freeze_list', address)).toBe('true')
    }
  })

  it('mints with a real non-inclusion witness against the populated list', async () => {
    const user = ctx.user
    expect(frozen).not.toContain(user.account.address)

    // The proof pair the AMM verifies for signer, recipient and withdrawal —
    // all this user, so one witness covers each slot.
    const proofs = buildExclusionProof({ tree, address: user.account.address })
    const [left, right] = proofs

    // A populated list means a genuine path: the leaf slots hold real addresses
    // rather than the all-zero witness an empty list produces.
    expect(left.siblings).toHaveLength(16)
    expect(left.siblings.slice(0, 2).every((s) => s === '0field')).toBe(false)

    // Depth 3 means slots 0-3 carry the path and slot 4 terminates it, so the
    // verifier's climb loop runs twice rather than the single iteration a
    // four-leaf tree would produce.
    expect(left.siblings.slice(0, 4).every((s) => s !== '0field')).toBe(true)
    expect(left.siblings[4]).toBe('0field')

    const realProofs: ProofProvider = async () => proofs

    const record0 = await ctx.mintTokenTo(user, ctx.token0.program, MINT)
    const record1 = await ctx.mintTokenTo(user, ctx.token1.program, MINT)

    const dex = user.walletClient.extend(shieldSwapActions({ program: AMM_PROGRAM })) as ReturnType<
      ReturnType<typeof shieldSwapActions>
    >
    const result = await dex.mint({
      poolKey: ctx.poolKey,
      tickLower: -10 * ctx.tickSpacing,
      tickUpper: 10 * ctx.tickSpacing,
      amount0Desired: MINT / 2n,
      amount1Desired: MINT / 2n,
      recipient: user.account.address,
      withdrawal: user.account.address,
      token0Record: record0,
      token1Record: record1,
      proofs: realProofs,
      imports: ctx.imports,
    })

    // Acceptance is the assertion: the AMM recomputed the root from this
    // witness, matched it against the freezelist mapping, and cleared the
    // bracket and adjacency checks.
    expect(result.positionTokenId).toMatch(/field$/)
    const { status } = await user.walletClient.transactionStatus({ transactionId: result.transactionId })
    expect(status).toBe('accepted')
  }, 900_000)

  it('refuses to build a witness for an address on the list', () => {
    for (const [index, address] of frozen.entries()) {
      expect(() => buildExclusionProof({ tree, address })).toThrow(FrozenAddressError)

      try {
        buildExclusionProof({ tree, address })
        expect.unreachable('expected FrozenAddressError')
      } catch (error) {
        // One padding leaf precedes three sorted addresses, so leaf 0 is the
        // pad and every frozen address sits at 1 or above.
        expect((error as FrozenAddressError).leafIndex).toBeGreaterThan(0)
        expect(frozen[index]).toBe(address)
      }
    }
  })
})

describe('freezelist fixture bytecode rewriting', () => {
  const DEVNODE = 'aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px'
  const OWNER = 'aleo1z3zwzgpgakk89xpknync5rtklkjkyv33g7cvaqe0gku64zs3lv9qyux0qc'

  it('repoints every authority occurrence the deployed program carries', () => {
    const source = `constructor:\n    assert.eq program_owner ${OWNER};\nfinalize initialize:\n    assert.eq r1 ${OWNER};\n`
    const rewritten = repointAuthorities(FREEZELIST_PROGRAM, source, DEVNODE)

    expect(rewritten).not.toContain(OWNER)
    expect(rewritten.split(DEVNODE).length - 1).toBe(2)
  })

  it('fails loudly when the deployed bytecode carries a different authority count', () => {
    // An upstream redeploy that adds or removes an authority must not silently
    // produce a stack nobody can drive.
    expect(() => repointAuthorities(FREEZELIST_PROGRAM, `assert.eq program_owner ${OWNER};`, DEVNODE)).toThrow(
      /expected 2 occurrence/,
    )
  })

  it('leaves programs without a declared authority untouched', () => {
    const source = 'program shield_swap_multisig_core.aleo;'
    expect(repointAuthorities('shield_swap_multisig_core.aleo', source, DEVNODE)).toBe(source)
  })

  it('pads a three-address list to four leaves and seven tree entries', () => {
    const addresses = [
      'aleo1u6uncxcfjq5nyj6973c2c78tl5qqrndqk08a4ty64lr8qfhndqzqdajefz',
      'aleo1mzdrfndksxqe0yn2962f6fsf6u99jkrpl8cd3wewk68pqqdn5czsu72kk3',
      'aleo1p4qrjqgwlargmf8zyurj9pd7pmyayath26hxz2fn37rq8y9xs5rsygzms4',
    ]
    const built = freezeListTree(addresses)

    expect(built).toHaveLength(7)
    expect(built[0]).toBe('0')
    // Leaves sort ascending, which is what makes bracketing meaningful.
    const leaves = built.slice(0, 4).map(BigInt)
    expect(leaves).toEqual([...leaves].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
  })
})
