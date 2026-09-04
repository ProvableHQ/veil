import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BridgeError } from '../../src/errors/bridgeErrors.js'
import { quoteIgpGasPayment } from '../../src/solana/igp.js'

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/sealevel-igp-account.json', import.meta.url), 'utf8'),
) as { dataBase64: string }

// SEALEVEL_NOTES.md §1, §4: Aleo mainnet's Hyperlane domain, and the warp
// token's `destination_gas` value for that domain confirmed against the real
// deposit's "Paid IGP … for 464000 gas …" log line.
const ALEO_MAINNET_DOMAIN = 1634493807
const DESTINATION_GAS_AMOUNT = 464000n

// SEALEVEL_NOTES.md §4: the exact lamport figure reproduced from the pinned
// formula and independently confirmed against the real deposit's observed
// lamport delta on the inner IGP account (1432395649 - 1429495649).
const EXPECTED_QUOTE_LAMPORTS = 2_900_000n

function igpAccountData(): Uint8Array {
  return Uint8Array.from(atob(fixture.dataBase64), (char) => char.charCodeAt(0))
}

describe('quoteIgpGasPayment', () => {
  it('reproduces the SEALEVEL_NOTES.md §4 quote for the Aleo mainnet domain', () => {
    const lamports = quoteIgpGasPayment({
      igpAccountData: igpAccountData(),
      destinationDomain: ALEO_MAINNET_DOMAIN,
      gasAmount: DESTINATION_GAS_AMOUNT,
    })
    expect(lamports).toBe(EXPECTED_QUOTE_LAMPORTS)
  })

  it('throws a BridgeError when the account has no gas-oracle entry for the domain', () => {
    expect(() =>
      quoteIgpGasPayment({
        igpAccountData: igpAccountData(),
        destinationDomain: 999_999_999,
        gasAmount: 1n,
      }),
    ).toThrowError(BridgeError)
  })

  it('throws a BridgeError when the gas-oracle entry carries an unrecognized variant tag', () => {
    // Minimal synthetic account matching the header + single-entry layout
    // documented in SEALEVEL_NOTES.md §4:
    // [1B initialized][8B discriminator][1B bump_seed][32B salt]
    // [1B owner Option tag (None)][32B beneficiary][4B oracle count = 1]
    // [4B domain][1B GasOracle tag][16B exchange rate][16B gas price][1B decimals]
    const domain = 42
    const headerBytes = 1 + 8 + 1 + 32 + 1 + 32 + 4
    const entryBytes = 4 + 1 + 16 + 16 + 1
    const data = new Uint8Array(headerBytes + entryBytes)
    const view = new DataView(data.buffer)
    view.setUint32(1 + 8 + 1 + 32 + 1 + 32, 1, true) // oracle count = 1
    const entryStart = headerBytes
    view.setUint32(entryStart, domain, true)
    view.setUint8(entryStart + 4, 7) // unrecognized GasOracle variant tag

    expect(() =>
      quoteIgpGasPayment({
        igpAccountData: data,
        destinationDomain: domain,
        gasAmount: 1n,
      }),
    ).toThrowError(/unexpected GasOracle variant tag 7/)
  })
})
