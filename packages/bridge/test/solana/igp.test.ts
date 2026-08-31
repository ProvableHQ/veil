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
})
