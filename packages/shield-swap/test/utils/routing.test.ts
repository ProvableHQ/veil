import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  resolveTokenRoute,
  tokenIdToProgram,
  programToTokenId,
  clearRouteCache,
} from '../../src/utils/routing.js'
import { EMPTY_MERKLE_PROOFS, formatMerkleProofPair, resolveProofPair } from '../../src/utils/proofs.js'
import { detectTokenStandard } from '../../src/utils/detectTokenStandard.js'
import { parseTokenRecordInfo } from '../../src/utils/records.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Live-verified encodings: test_arc20_eth and shield_swap_arc20_credits token
// ids as served by the DEX API for the deployed pools.
const ETH_ID = '2118592438692976300771526183183732field'
const WALEO_ID = '724721105858008932013114020280511843613117371369744086165619field'
const CREDITS_ID = programToTokenId('credits.aleo')

function clientReturning(byKey: Record<string, string | null>) {
  const request = vi.fn(async ({ params }: any) => {
    const value = byKey[params.key]
    return value === undefined ? null : value
  })
  return { request, client: { request } as any }
}

beforeEach(() => clearRouteCache())

describe('token id encoding', () => {
  it('round-trips program names through field encoding', () => {
    expect(programToTokenId('test_arc20_eth.aleo')).toBe(ETH_ID)
    expect(programToTokenId('shield_swap_arc20_credits.aleo')).toBe(WALEO_ID)
    expect(tokenIdToProgram(ETH_ID)).toBe('test_arc20_eth.aleo')
    expect(tokenIdToProgram(WALEO_ID)).toBe('shield_swap_arc20_credits.aleo')
  })

  it('rejects fields that do not decode to program names', () => {
    expect(tokenIdToProgram('12field')).toBeUndefined()
    expect(tokenIdToProgram('not-a-field')).toBeUndefined()
  })
})

describe('resolveTokenRoute', () => {
  it('classifies a plain token when the wrapper mapping has no entry', async () => {
    const { client } = clientReturning({})
    const route = await resolveTokenRoute(client, { tokenId: ETH_ID })
    expect(route).toEqual({ tokenId: ETH_ID, wrapped: false })
  })

  it('resolves a wrapped token to its underlying programs', async () => {
    const { client } = clientReturning({ [WALEO_ID]: CREDITS_ID })
    const route = await resolveTokenRoute(client, { tokenId: WALEO_ID })
    expect(route).toEqual({
      tokenId: WALEO_ID,
      wrapped: true,
      underlyingId: CREDITS_ID,
      wrapperProgram: 'shield_swap_arc20_credits.aleo',
      underlyingProgram: 'credits.aleo',
    })
  })

  it('caches resolutions (wrapper relationships are immutable)', async () => {
    const { client, request } = clientReturning({ [WALEO_ID]: CREDITS_ID })
    await resolveTokenRoute(client, { tokenId: WALEO_ID })
    await resolveTokenRoute(client, { tokenId: WALEO_ID })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('honors a pre-resolved route without any request', async () => {
    const { client, request } = clientReturning({})
    const route = await resolveTokenRoute(client, {
      tokenId: ETH_ID,
      route: { tokenId: ETH_ID, wrapped: false },
    })
    expect(route.wrapped).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })
})

describe('proofs', () => {
  it('formats the empty-tree witness pair exactly as the contracts expect', () => {
    const literal = formatMerkleProofPair(EMPTY_MERKLE_PROOFS)
    expect(literal.startsWith('[{ siblings: [0field, 0field')).toBe(true)
    expect(literal).toContain('leaf_index: 1u32')
    expect((literal.match(/0field/g) ?? []).length).toBe(32)
  })

  it('resolveProofPair defaults to the empty witness and defers to a provider', async () => {
    await expect(resolveProofPair(undefined, { list: 'amm', program: 'f.aleo', subject: 'aleo1x' })).resolves.toBe(
      EMPTY_MERKLE_PROOFS,
    )
    const custom = [
      { siblings: Array(16).fill('1field'), leaf_index: 2 },
      { siblings: Array(16).fill('2field'), leaf_index: 3 },
    ] as const
    const provider = vi.fn(async () => custom)
    await expect(resolveProofPair(provider, { list: 'wrapper', program: 'f.aleo', subject: 'aleo1x' })).resolves.toBe(
      custom,
    )
    expect(provider).toHaveBeenCalledWith({ list: 'wrapper', program: 'f.aleo', subject: 'aleo1x' })
  })
})

describe('detectTokenStandard', () => {
  const arc20Source = readFileSync(
    join(__dirname, '../../../core/test/fixtures/programs/test_arc20_eth.aleo'),
    'utf8',
  )

  it('detects ARC-20 from source with the pure engine', async () => {
    await expect(detectTokenStandard({} as any, { source: arc20Source, engine: 'pure' })).resolves.toBe('arc20')
  })

  it('detects none for a non-token program', async () => {
    await expect(
      detectTokenStandard({} as any, { source: 'program empty.aleo;\nfunction f:\n', engine: 'pure' }),
    ).resolves.toBe('none')
  })

  it('auto engine agrees with pure on the same source', async () => {
    await expect(detectTokenStandard({} as any, { source: arc20Source })).resolves.toBe('arc20')
  })
})

describe('recipient-bound wrapper records', () => {
  it('parses binding fields and exposes them', () => {
    const info = parseTokenRecordInfo(
      '{ owner: aleo1me.private, amount: 5u128.private, recipient_bound: true.private, bound_recipient: aleo1cold.private, _nonce: 1group.public }',
    )
    expect(info).toMatchObject({ amount: 5n, recipientBound: true, boundRecipient: 'aleo1cold' })
  })

  it('treats ordinary records as unbound', () => {
    const info = parseTokenRecordInfo('{ owner: aleo1me.private, amount: 5u128.private, _nonce: 1group.public }')
    expect(info).toMatchObject({ amount: 5n, recipientBound: false })
  })
})
