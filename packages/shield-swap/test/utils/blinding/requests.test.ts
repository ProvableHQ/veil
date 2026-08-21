import { describe, it, expect } from 'vitest'
import {
  shieldSwapAlgorithmGrants,
  SHIELD_SWAP_ALGORITHM_GRANTS,
  blindingFactorIssueRequest,
  blindedAddressIssueRequest,
  blindingFactorResolveRequest,
  BLINDING_FACTOR_ALGORITHM,
  BLINDED_ADDRESS_ALGORITHM,
} from '../../../src/utils/blinding/requests.js'

// The grant positions are bytecode facts: each tuple must match the deployed
// transition's input declaration or the wallet refuses the derived request.
const EXPECTED_POSITIONS: Array<[string, string, number, number]> = [
  ['shield_swap.aleo', 'swap', 1, 2],
  ['shield_swap.aleo', 'swap_multi_hop', 0, 1],
  ['shield_swap.aleo', 'claim_swap_output', 0, 1],
  ['shield_swap_router.aleo', 'swap_from_wrapped', 2, 3],
  ['shield_swap_router.aleo', 'swap_mh_from_wrapped', 2, 3],
  ['shield_swap_router.aleo', 'claim_to_wrapped_refund_arc20', 0, 1],
  ['shield_swap_router.aleo', 'claim_to_arc20_refund_wrapped', 0, 1],
  ['shield_swap_router.aleo', 'claim_to_wrapped_refund_wrapped', 0, 1],
  ['shield_swap.aleo', 'claim_swap_output_no_refund', 0, 1],
  ['shield_swap_router.aleo', 'claim_to_arc20_no_refund', 0, 1],
  ['shield_swap_router.aleo', 'claim_to_wrapped_no_refund', 0, 1],
]

describe('shieldSwapAlgorithmGrants', () => {
  it('grants the blinding pair at the deployed input positions for every transition', () => {
    const grants = shieldSwapAlgorithmGrants()
    expect(grants).toHaveLength(EXPECTED_POSITIONS.length * 2)
    for (const [program, fn, factorPos, addressPos] of EXPECTED_POSITIONS) {
      expect(grants).toContainEqual({
        algorithm: BLINDING_FACTOR_ALGORITHM,
        program,
        function: fn,
        inputPosition: factorPos,
      })
      expect(grants).toContainEqual({
        algorithm: BLINDED_ADDRESS_ALGORITHM,
        program,
        function: fn,
        inputPosition: addressPos,
      })
    }
  })

  it('applies program overrides to core and router grants separately', () => {
    const grants = shieldSwapAlgorithmGrants({ program: 'core_x.aleo', routerProgram: 'router_x.aleo' })
    expect(grants.filter((g) => g.program === 'core_x.aleo')).toHaveLength(8)
    expect(grants.filter((g) => g.program === 'router_x.aleo')).toHaveLength(14)
  })

  it('exposes the default set as SHIELD_SWAP_ALGORITHM_GRANTS', () => {
    expect(SHIELD_SWAP_ALGORITHM_GRANTS).toEqual(shieldSwapAlgorithmGrants())
  })

  it('grants the no-refund claim transitions at blinding positions 0-1', () => {
    const grants = shieldSwapAlgorithmGrants()
    for (const [program, fn] of [
      ['shield_swap.aleo', 'claim_swap_output_no_refund'],
      ['shield_swap_router.aleo', 'claim_to_arc20_no_refund'],
      ['shield_swap_router.aleo', 'claim_to_wrapped_no_refund'],
    ] as const) {
      for (const inputPosition of [0, 1]) {
        expect(grants).toContainEqual(expect.objectContaining({ program, function: fn, inputPosition }))
      }
    }
  })
})

describe('derived request builders', () => {
  it('scopes issue-mode requests to shield_swap.aleo by default', () => {
    expect(blindingFactorIssueRequest()).toMatchObject({
      type: 'derived',
      algorithm: BLINDING_FACTOR_ALGORITHM,
      args: {
        mode: { type: 'string', value: 'issue' },
        membershipProgram: { type: 'string', value: 'shield_swap.aleo' },
        membershipMapping: { type: 'string', value: 'used_blinded_addresses' },
      },
    })
    expect(blindedAddressIssueRequest('other.aleo').args).toMatchObject({
      membershipProgram: { type: 'string', value: 'other.aleo' },
    })
  })

  it('targets the swap blinded address in resolve mode', () => {
    const target = 'aleo1t08epjqqv8h7jpuy2m2cxm80zy2pcy5c4f3m82hnac4sjmdrjyysvx3s2h'
    expect(blindingFactorResolveRequest(target)).toMatchObject({
      args: {
        mode: { type: 'string', value: 'resolve' },
        targetAddress: { type: 'address', value: target },
        membershipProgram: { type: 'string', value: 'shield_swap.aleo' },
      },
    })
  })
})
