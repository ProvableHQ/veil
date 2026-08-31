import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SolanaHyperlaneRouteMetadata } from '../../src/types/solana.js'
import { buildTransferRemoteInstruction } from '../../src/solana/transferRemote.js'

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/sealevel-transfer-remote.json', import.meta.url), 'utf8'),
) as {
  senderAddress: string
  uniqueMessageAddress: string
  recipientAleoAddress: string
  amountLamports: number
  instructionDataBase64: string
  accounts: { address: string; signer: boolean; writable: boolean }[]
}

// Warp program id is not itself a fixture field (it only appears in the raw
// transaction's invoke logs), but it is a pinned fact in SEALEVEL_NOTES.md's
// intro (the deployed SOL warp route program address).
const WARP_PROGRAM_ADDRESS = '8YGT2pZwyZe94qBpGzWfY2TMEVcwaQ1bXAE7YAgpUaM7'

/**
 * Maps the golden fixture's ordered account list onto
 * `SolanaHyperlaneRouteMetadata`, per the static/per-transfer labels in
 * SEALEVEL_NOTES.md §2. Per-transfer accounts (sender, unique message) and
 * derived PDAs (dispatched-message, gas-payment) are supplied separately by
 * `buildTransferRemoteInstruction`'s own parameters/derivation, not metadata.
 */
function metadataFromFixture(f: typeof fixture): SolanaHyperlaneRouteMetadata {
  const accounts = f.accounts
  return {
    warpProgramAddress: WARP_PROGRAM_ADDRESS,
    tokenPda: accounts[2]!.address,
    nativeCollateralPda: accounts[15]!.address,
    dispatchAuthorityPda: accounts[5]!.address,
    mailboxProgramAddress: accounts[3]!.address,
    mailboxOutboxPda: accounts[4]!.address,
    igpProgramAddress: accounts[9]!.address,
    igpProgramDataPda: accounts[10]!.address,
    igpOverheadAccount: accounts[12]!.address,
    igpAccount: accounts[13]!.address,
    splNoopProgramAddress: accounts[1]!.address,
    destinationDomain: 1634493807, // SEALEVEL_NOTES.md §1, Aleo mainnet's Hyperlane domain
    destinationGasAmount: '464000', // SEALEVEL_NOTES.md §4, token's destination_gas for this domain
    registryCommit: '418056e21734d26a7d14692e0ec5e902cc9e86bf',
    solanaReviewedAt: '2026-08-28T00:00:00Z',
    solanaConfigSource: 'hyperlane-registry@418056e2:deployments/warp_routes/SOL/aleo-config.yaml',
  }
}

describe('buildTransferRemoteInstruction', () => {
  it('reproduces the mainnet TransferRemote instruction byte-for-byte', async () => {
    const built = await buildTransferRemoteInstruction({
      metadata: metadataFromFixture(fixture),
      senderAddress: fixture.senderAddress,
      uniqueMessageAddress: fixture.uniqueMessageAddress,
      recipientAleoAddress: fixture.recipientAleoAddress,
      amountLamports: BigInt(fixture.amountLamports),
    })
    expect(built.programAddress).toBe(WARP_PROGRAM_ADDRESS)
    expect(Buffer.from(built.data).toString('base64')).toBe(fixture.instructionDataBase64)
    expect(built.accounts).toEqual(fixture.accounts)
  })
})
