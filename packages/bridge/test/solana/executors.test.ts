import { createKeyPairFromPrivateKeyBytes } from '@solana/kit'
import { describe, expect, it, vi } from 'vitest'
import { createSolanaClient, solanaCustom, solanaKeyPair, solanaWallet } from '../../src/connections/solana.js'
import sealevelFixture from '../fixtures/sealevel-transfer-remote.json' with { type: 'json' }

const SEED = new Uint8Array(32).fill(1)

async function buildSecretKeyBytes(): Promise<Uint8Array> {
  const { publicKey } = await createKeyPairFromPrivateKeyBytes(SEED)
  const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey))
  return new Uint8Array([...SEED, ...publicKeyBytes])
}

describe('Solana client accounts', () => {
  it('routes submission through the Wallet Standard account and chain', async () => {
    const signAndSendTransaction = vi.fn(async () => [{ signature: new Uint8Array([1, 2, 3]) }])
    const client = createSolanaClient({
      transport: solanaCustom(async () => undefined),
      account: solanaWallet({
        wallet: { features: { 'solana:signAndSendTransaction': { signAndSendTransaction } } },
        account: { address: sealevelFixture.senderAddress, publicKey: new Uint8Array(32) },
        chain: 'solana:mainnet',
      }),
    })

    expect(await client.walletClient?.sendTransaction(new Uint8Array([9]))).toEqual({ signature: 'Ldp' })
    expect(signAndSendTransaction).toHaveBeenCalledWith(expect.objectContaining({ chain: 'solana:mainnet' }))
  })

  it('derives a stable local address without giving the account an RPC config', async () => {
    const secretKeyBytes = await buildSecretKeyBytes()
    const request = vi.fn()
    const client = createSolanaClient({
      transport: solanaCustom(request),
      account: solanaKeyPair(secretKeyBytes),
    })

    const address = await client.walletClient?.getAddress()
    expect(address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    expect(request).not.toHaveBeenCalled()
  })
})
