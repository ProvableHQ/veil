import { describe, it, expect } from 'vitest'
import type { Client } from '@veil/core'
import {
  deriveBlindingFactor,
  deriveBlindedAddress,
  nextBlindedIdentity,
} from '../src/blinded-identity.js'
import { SHIELD_SWAP_V0_0_2 } from '../src/constants.js'

// Vectors were generated for the v0_0_2 program scope — pin it explicitly
// (the library default now targets the live v0_0_1 deployment). The e2e
// validates the default-program derivation against the chain itself.

// Golden vectors generated from an independent verbatim transcription of the
// Provable reference client (amm-v3-tests @feat/q128 amm-client.ts), using the
// devnode account (public test key). Our port must reproduce them exactly —
// the program's verify_blinded_address re-computes this hash and rejects any
// deviation. Final authority is the on-chain assert, exercised by the e2e.
const VIEW_KEY_SCALAR = '334926304971763782347498121479281870911723639068413954564748091722770623877scalar'
const SIGNER = 'aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px'
const VECTORS = [
  {
    counter: 0,
    blindingFactor: '75213284694480094547376579855946343029115477561379226330100664208676717902field',
    blindedAddress: 'aleo10yj3dlnf69hh29gt5ev4e2rh00x0stger8plrw0vzmttlkmvssgsqagyyy',
  },
  {
    counter: 1,
    blindingFactor: '885616432807387273575097063953109865545255848018492703828290462284749218881field',
    blindedAddress: 'aleo1fft6y3stxyzjut637lykjdnkqrm9jenldfrz77sfl5aauaasfcxqa03kgv',
  },
  {
    counter: 7,
    blindingFactor: '4746641973984105455434059665400634378069487314248746135197221565741750683010field',
    blindedAddress: 'aleo1aary2kkq62cjr2fjvdk95r5szcqdcyl53hwt7jx4ldl3t603kg9qvlzcsw',
  },
]

describe('blinded identity derivation (golden vectors)', () => {
  for (const v of VECTORS) {
    it(`counter ${v.counter} reproduces the reference derivation`, async () => {
      const bf = await deriveBlindingFactor(VIEW_KEY_SCALAR, v.counter, SHIELD_SWAP_V0_0_2)
      expect(bf).toBe(v.blindingFactor)
      const addr = await deriveBlindedAddress(bf, SIGNER, SHIELD_SWAP_V0_0_2)
      expect(addr).toBe(v.blindedAddress)
    })
  }

  it('is deterministic across calls (no wasm object reuse bugs)', async () => {
    const a = await deriveBlindingFactor(VIEW_KEY_SCALAR, 0, SHIELD_SWAP_V0_0_2)
    const b = await deriveBlindingFactor(VIEW_KEY_SCALAR, 0, SHIELD_SWAP_V0_0_2)
    expect(a).toBe(b)
    expect(await deriveBlindedAddress(a, SIGNER, SHIELD_SWAP_V0_0_2)).toBe(await deriveBlindedAddress(b, SIGNER, SHIELD_SWAP_V0_0_2))
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
      program: SHIELD_SWAP_V0_0_2,
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
      program: SHIELD_SWAP_V0_0_2,
    })
    expect(id.counter).toBe(2)
    expect(id.blindedAddress).not.toBe(VECTORS[0]!.blindedAddress)
    expect(id.blindedAddress).not.toBe(VECTORS[1]!.blindedAddress)
  })

  it('respects startCounter and throws when the scan window is exhausted', async () => {
    const id = await nextBlindedIdentity(scanClient(new Set()), {
      viewKeyScalar: VIEW_KEY_SCALAR,
      signer: SIGNER,
      program: SHIELD_SWAP_V0_0_2,
      startCounter: 7,
    })
    expect(id.counter).toBe(7)
    expect(id.blindingFactor).toBe(VECTORS[2]!.blindingFactor)

    // Every address reads as used → the window exhausts.
    const allUsed = { request: async () => 'true' } as unknown as Client
    await expect(
      nextBlindedIdentity(allUsed, { viewKeyScalar: VIEW_KEY_SCALAR, signer: SIGNER, program: SHIELD_SWAP_V0_0_2, maxScan: 3 }),
    ).rejects.toThrow(/No unused blinded address/)
  })
})
