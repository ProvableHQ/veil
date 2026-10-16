import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FREEZELIST_PROOF_ALGORITHM, freezelistProofRequest } from '@provablehq/veil-core'
import {
  EMPTY_MERKLE_PROOFS,
  formatMerkleProofPair,
  resolveProofPair,
  resolveProofInput,
  walletFreezelistProofProvider,
  proofProviderForAccount,
} from '../../src/utils/proofs.js'
import { shieldSwapFreezelistGrants } from '../../src/utils/freezelistGrants.js'
import { shieldSwapAlgorithmGrants } from '../../src/utils/blinding/requests.js'

const config = {
  ammFreezelistProgram: 'custom_amm_list.aleo',
  wrapperFreezelists: { 'wrap_a.aleo': 'list_a.aleo', 'wrap_b.aleo': 'list_b.aleo', 'wrap_credits.aleo': null },
}
const context = { list: 'amm' as const, program: 'shield_swap_freezelist.aleo', subject: 'aleo1subject' }

describe('wallet freezelist proof inputs', () => {
  it('preserves the existing pair-provider contract and formats pair/string inputs', async () => {
    const provider = async () => EMPTY_MERKLE_PROOFS
    expect(await resolveProofPair(provider, context)).toBe(EMPTY_MERKLE_PROOFS)
    expect(await resolveProofInput(provider, context)).toBe(formatMerkleProofPair(EMPTY_MERKLE_PROOFS))
    expect(await resolveProofInput(async () => '[literal]', context)).toBe('[literal]')
  })

  it('uses the configured AMM list and resolves wrappers through explicit deployment metadata', async () => {
    const provider = walletFreezelistProofProvider(config)
    expect(await resolveProofInput(provider, context)).toEqual(freezelistProofRequest({ freezelistProgram: 'custom_amm_list.aleo', address: context.subject }))
    expect(await resolveProofInput(provider, { ...context, list: 'wrapper', program: 'wrap_a.aleo' })).toEqual(freezelistProofRequest({ freezelistProgram: 'list_a.aleo', address: context.subject }))
    expect(await resolveProofInput(provider, { ...context, list: 'wrapper', program: 'wrap_b.aleo' })).toEqual(freezelistProofRequest({ freezelistProgram: 'list_b.aleo', address: context.subject }))
  })

  it('uses the wallet signer default only when the context explicitly identifies a signer slot', async () => {
    const provider = walletFreezelistProofProvider(config)
    const signerContext = { ...context, subjectIsSigner: true }
    expect(await resolveProofInput(provider, signerContext)).toEqual(freezelistProofRequest({ freezelistProgram: 'custom_amm_list.aleo' }))
    expect(await resolveProofInput(provider, { ...signerContext, list: 'wrapper', program: 'wrap_a.aleo' })).toEqual(freezelistProofRequest({ freezelistProgram: 'list_a.aleo' }))
  })

  it('requires an explicit mapping and permits a placeholder only for an explicit no-compliance entry', async () => {
    const provider = walletFreezelistProofProvider(config)
    expect(await resolveProofInput(provider, { ...context, list: 'wrapper', program: 'wrap_credits.aleo' })).toBe(formatMerkleProofPair(EMPTY_MERKLE_PROOFS))
    await expect(resolveProofInput(provider, { ...context, list: 'wrapper', program: 'missing.aleo' })).rejects.toThrow('missing.aleo')
    await expect(resolveProofInput(provider, { ...context, list: 'wrapper', program: 'toString' })).rejects.toThrow('toString')
  })

  it('rejects wallet proof requests for local accounts while preserving literal providers', async () => {
    const provider = proofProviderForAccount(walletFreezelistProofProvider(config), 'local')
    await expect(resolveProofInput(provider, context)).rejects.toThrow('wallet')
    expect(await resolveProofInput(proofProviderForAccount(async () => EMPTY_MERKLE_PROOFS, 'local'), context)).toBe(formatMerkleProofPair(EMPTY_MERKLE_PROOFS))
  })
})

describe('freezelist grants', () => {
  it('covers every proof slot in the pinned core and three router ABIs with the correct list constraints', () => {
    const grants = shieldSwapFreezelistGrants(config)
    const expected: string[] = []
    for (const name of ['shield_swap', 'shield_swap_router', 'shield_swap_lp_router', 'shield_swap_rebalance_router']) {
      const abi = JSON.parse(readFileSync(new URL(`../../codegen/abi/${name}.json`, import.meta.url), 'utf8'))
      for (const fn of abi.functions) {
        fn.inputs.forEach((input: any, inputPosition: number) => {
          const struct = input?.Plaintext?.ty?.Array?.element?.Struct
          if (!struct?.path?.includes('MerkleProof')) return
          expected.push(`${abi.program}/${fn.name}/${inputPosition}`)
          expect(grants).toContainEqual({
            algorithm: FREEZELIST_PROOF_ALGORITHM,
            program: abi.program,
            function: fn.name,
            inputPosition,
            argConstraints: { freezelistProgram: struct.program === 'shield_swap.aleo' ? ['custom_amm_list.aleo'] : ['list_a.aleo', 'list_b.aleo'] },
          })
        })
      }
    }
    expect(grants.map(g => `${g.program}/${g.function}/${g.inputPosition}`).sort()).toEqual(expected.sort())
  })

  it('composes with blinding grants only when explicitly requested', () => {
    const blinding = shieldSwapAlgorithmGrants()
    expect(blinding.every(g => g.algorithm !== FREEZELIST_PROOF_ALGORITHM)).toBe(true)
    expect(shieldSwapAlgorithmGrants({ freezelists: config })).toEqual([...blinding, ...shieldSwapFreezelistGrants(config)])
  })

  it('honors deployment overrides and emits no wrapper grants for an empty or no-compliance map', () => {
    const grants = shieldSwapFreezelistGrants({
      wrapperFreezelists: { 'credits_wrapper.aleo': null },
      program: 'core.aleo', routerProgram: 'swap.aleo', lpRouterProgram: 'lp.aleo', rebalanceRouterProgram: 'rebalance.aleo',
    })
    expect(new Set(grants.map(g => g.program))).toEqual(new Set(['core.aleo', 'swap.aleo', 'lp.aleo', 'rebalance.aleo']))
    expect(grants.every(g => JSON.stringify(g.argConstraints) === JSON.stringify({ freezelistProgram: ['shield_swap_freezelist.aleo'] }))).toBe(true)
  })
})
