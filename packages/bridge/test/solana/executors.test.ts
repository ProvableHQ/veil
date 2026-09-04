import { createKeyPairFromPrivateKeyBytes } from '@solana/kit'
import { describe, expect, it, vi } from 'vitest'
import { solanaExecutorFromKeyPair, solanaExecutorFromWalletAccount } from '../../src/solana/index.js'
import sealevelFixture from '../fixtures/sealevel-transfer-remote.json' with { type: 'json' }

const FIXTURE_SENDER_ADDRESS = sealevelFixture.senderAddress

// `new Uint8Array(64).fill(1)` is not a valid Ed25519 secret key: `@solana/kit`
// verifies that the trailing 32 "public key" bytes actually correspond to the
// leading 32-byte private key (it signs and verifies a probe message), so a
// hand-rolled all-1s fill is rejected. Derive a real, deterministic keypair
// from a fixed 32-byte seed instead and concatenate the two halves into the
// 64-byte secret key format `solanaExecutorFromKeyPair` expects.
const SEED = new Uint8Array(32).fill(1)

async function buildSecretKeyBytes(): Promise<Uint8Array> {
  const { publicKey } = await createKeyPairFromPrivateKeyBytes(SEED)
  const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey))
  const secretKeyBytes = new Uint8Array(64)
  secretKeyBytes.set(SEED, 0)
  secretKeyBytes.set(publicKeyBytes, 32)
  return secretKeyBytes
}

describe('solanaExecutorFromWalletAccount', () => {
  it('routes signAndSendTransaction through the wallet feature with account and chain', async () => {
    const signAndSendTransaction = vi.fn(async () => [{ signature: new Uint8Array([1, 2, 3]) }])
    const executor = solanaExecutorFromWalletAccount({
      wallet: { features: { 'solana:signAndSendTransaction': { signAndSendTransaction } } },
      account: { address: FIXTURE_SENDER_ADDRESS, publicKey: new Uint8Array(32) },
      chain: 'solana:mainnet',
    })
    expect(await executor.getAddress()).toBe(FIXTURE_SENDER_ADDRESS)
    const result = await executor.signAndSendTransaction(new Uint8Array([9]))
    expect(signAndSendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ chain: 'solana:mainnet', transaction: new Uint8Array([9]) }),
    )
    expect(result.signature).toBe('Ldp') // bs58 of [1,2,3]
  })

  it('throws a BridgeError naming the missing feature', () => {
    expect(() =>
      solanaExecutorFromWalletAccount({
        wallet: { features: {} },
        account: { address: 'x', publicKey: new Uint8Array(32) },
        chain: 'solana:mainnet',
      }),
    ).toThrowError(/solana:signAndSendTransaction/)
  })
})

describe('solanaExecutorFromKeyPair', () => {
  it('derives a stable base58 address from the secret key', async () => {
    const secretKeyBytes = await buildSecretKeyBytes()
    const executor = await solanaExecutorFromKeyPair({ secretKeyBytes, rpc: { url: 'http://unused' } })
    const address = await executor.getAddress()
    expect(address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    expect(address).toBe(
      await (await solanaExecutorFromKeyPair({ secretKeyBytes, rpc: { url: 'http://unused' } })).getAddress(),
    )
  })
})
