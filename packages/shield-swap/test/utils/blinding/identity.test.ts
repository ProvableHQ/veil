import { describe, it, expect } from 'vitest'
import type { Client } from '@veil/core'
import {
  deriveBlindingFactor,
  deriveBlindedAddress,
  nextBlindedIdentity,
} from '../../../src/utils/blinding/identity.js'
import { SHIELD_SWAP_V3 } from '../../../src/constants.js'

// Golden vectors pinned to the SHIELD_SWAP_V3 program scope (the derivation
// hashes the program address, so vectors are scope-specific). Our port must
// reproduce them exactly — the program's verify_blinded_address re-computes
// this hash and rejects any deviation. Final authority is the on-chain assert,
// exercised by the e2e.
const VIEW_KEY_SCALAR = '334926304971763782347498121479281870911723639068413954564748091722770623877scalar'
const SIGNER = 'aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px'
const VECTORS = [
  {
    counter: 0,
    blindingFactor: '4588552248780721950435785476596782217652350429588181106944985529417784595808field',
    blindedAddress: 'aleo1tucdl48jvu54emu9atq3vf0rslwtdpze83zcc2jrc8zxema0r5gq3zd76l',
  },
  {
    counter: 1,
    blindingFactor: '6996211042158127437642182917952771252908546914090630418129936449807650494378field',
    blindedAddress: 'aleo17gc56avc2x3dwj3mjazag8szl5skm8y4u5h6ep37kvl34cynrqyqm0cuj8',
  },
  {
    counter: 7,
    blindingFactor: '4426391170839722244039367865632426610408126795108463201618230895243256084792field',
    blindedAddress: 'aleo1jjq9qtr2uv86pans7f7v3tgcesg0autqhhu2cp2eecfxhtv4acgskyz80k',
  },
]

describe('blinded identity derivation (golden vectors)', () => {
  for (const v of VECTORS) {
    it(`counter ${v.counter} reproduces the reference derivation`, async () => {
      const bf = await deriveBlindingFactor(VIEW_KEY_SCALAR, v.counter, SHIELD_SWAP_V3)
      expect(bf).toBe(v.blindingFactor)
      const addr = await deriveBlindedAddress(bf, SIGNER, SHIELD_SWAP_V3)
      expect(addr).toBe(v.blindedAddress)
    })
  }

  it('is deterministic across calls (no wasm object reuse bugs)', async () => {
    const a = await deriveBlindingFactor(VIEW_KEY_SCALAR, 0, SHIELD_SWAP_V3)
    const b = await deriveBlindingFactor(VIEW_KEY_SCALAR, 0, SHIELD_SWAP_V3)
    expect(a).toBe(b)
    expect(await deriveBlindedAddress(a, SIGNER, SHIELD_SWAP_V3)).toBe(await deriveBlindedAddress(b, SIGNER, SHIELD_SWAP_V3))
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
      program: SHIELD_SWAP_V3,
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
      program: SHIELD_SWAP_V3,
    })
    expect(id.counter).toBe(2)
    expect(id.blindedAddress).not.toBe(VECTORS[0]!.blindedAddress)
    expect(id.blindedAddress).not.toBe(VECTORS[1]!.blindedAddress)
  })

  it('respects startCounter and throws when the scan window is exhausted', async () => {
    const id = await nextBlindedIdentity(scanClient(new Set()), {
      viewKeyScalar: VIEW_KEY_SCALAR,
      signer: SIGNER,
      program: SHIELD_SWAP_V3,
      startCounter: 7,
    })
    expect(id.counter).toBe(7)
    expect(id.blindingFactor).toBe(VECTORS[2]!.blindingFactor)

    // Every address reads as used → the window exhausts.
    const allUsed = { request: async () => 'true' } as unknown as Client
    await expect(
      nextBlindedIdentity(allUsed, { viewKeyScalar: VIEW_KEY_SCALAR, signer: SIGNER, program: SHIELD_SWAP_V3, maxScan: 3 }),
    ).rejects.toThrow(/No unused blinded address/)
  })
})
