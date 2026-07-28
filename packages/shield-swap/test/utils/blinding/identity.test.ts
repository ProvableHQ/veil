import { describe, it, expect } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import {
  deriveBlindingFactor,
  deriveBlindedAddress,
  nextBlindedIdentity,
} from '../../../src/utils/blinding/identity.js'

// Golden vectors pinned to the shield_swap.aleo program scope. The derivation
// hashes the program address, so both the blinding factor and the blinded
// address are scope-specific. The program's verify_blinded_address recomputes
// this hash and rejects any deviation; the on-chain assert (exercised by the
// devnode/e2e suites) is the final authority.
const SHIELD_SWAP = 'shield_swap.aleo'
const VIEW_KEY_SCALAR = '334926304971763782347498121479281870911723639068413954564748091722770623877scalar'
const SIGNER = 'aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px'
const VECTORS = [
  {
    counter: 0,
    blindingFactor: '1084832000575072863530983109046262857691989153364570676666410266416291033880field',
    blindedAddress: 'aleo15mstsvdtzqf5nw8rfzx8mrllwxt907amfpt8nx3p8cskj4wd3uxq4uywn9',
  },
  {
    counter: 1,
    blindingFactor: '5141395481140237504655245554781696675111779262144509416611105050866132602799field',
    blindedAddress: 'aleo1kafjl7kvfh8dwtqdwgje2maw5ugkm63pph5qt5d503yt8spg3u8s38haku',
  },
  {
    counter: 7,
    blindingFactor: '3586646586411194490118647465634943263277589324082503715221872233042073645843field',
    blindedAddress: 'aleo1xfe9cwtftdg5fhkcmtjh4xnuuqjlwqgzk5hz762rf7zef088tqzqgvpkj6',
  },
]

describe('blinded identity derivation (golden vectors)', () => {
  for (const v of VECTORS) {
    it(`counter ${v.counter} reproduces the reference derivation`, async () => {
      const bf = await deriveBlindingFactor(VIEW_KEY_SCALAR, v.counter, SHIELD_SWAP)
      expect(bf).toBe(v.blindingFactor)
      const addr = await deriveBlindedAddress(bf, SIGNER, SHIELD_SWAP)
      expect(addr).toBe(v.blindedAddress)
    })
  }

  it('is deterministic across calls (no wasm object reuse bugs)', async () => {
    const a = await deriveBlindingFactor(VIEW_KEY_SCALAR, 0, SHIELD_SWAP)
    const b = await deriveBlindingFactor(VIEW_KEY_SCALAR, 0, SHIELD_SWAP)
    expect(a).toBe(b)
    expect(await deriveBlindedAddress(a, SIGNER, SHIELD_SWAP)).toBe(await deriveBlindedAddress(b, SIGNER, SHIELD_SWAP))
  })
})

describe('nextBlindedIdentity (counter scan)', () => {
  /** Client whose used_blinded_addresses contains the given addresses. */
  function scanClient(used: Set<string>): Client {
    return {
      request: async (req: { params: { key: string } }) => (used.has(req.params.key) ? 'true' : null),
    } as unknown as Client
  }

  it('returns counter 0 when nothing is used', async () => {
    const id = await nextBlindedIdentity(scanClient(new Set()), {
      viewKeyScalar: VIEW_KEY_SCALAR,
      signer: SIGNER,
      program: SHIELD_SWAP,
    })
    expect(id.counter).toBe(0)
    expect(id.blindingFactor).toBe(VECTORS[0]!.blindingFactor)
    expect(id.blindedAddress).toBe(VECTORS[0]!.blindedAddress)
  })

  it('skips used addresses and returns the first free counter', async () => {
    const used = new Set([VECTORS[0]!.blindedAddress, VECTORS[1]!.blindedAddress])
    const id = await nextBlindedIdentity(scanClient(used), {
      viewKeyScalar: VIEW_KEY_SCALAR,
      signer: SIGNER,
      program: SHIELD_SWAP,
    })
    expect(id.counter).toBe(2)
    expect(id.blindedAddress).not.toBe(VECTORS[0]!.blindedAddress)
    expect(id.blindedAddress).not.toBe(VECTORS[1]!.blindedAddress)
  })

  it('respects startCounter and throws when the scan window is exhausted', async () => {
    const id = await nextBlindedIdentity(scanClient(new Set()), {
      viewKeyScalar: VIEW_KEY_SCALAR,
      signer: SIGNER,
      program: SHIELD_SWAP,
      startCounter: 7,
    })
    expect(id.counter).toBe(7)
    expect(id.blindingFactor).toBe(VECTORS[2]!.blindingFactor)

    // Every address reads as used → the window exhausts.
    const allUsed = { request: async () => 'true' } as unknown as Client
    await expect(
      nextBlindedIdentity(allUsed, { viewKeyScalar: VIEW_KEY_SCALAR, signer: SIGNER, program: SHIELD_SWAP, maxScan: 3 }),
    ).rejects.toThrow(/No unused blinded address/)
  })
})
