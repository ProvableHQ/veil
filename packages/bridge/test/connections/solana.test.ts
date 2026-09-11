import {
  address,
  blockhash,
  compileTransaction,
  createKeyPairFromPrivateKeyBytes,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit'
import { describe, expect, it, vi } from 'vitest'
import {
  createSolanaClient,
  solanaCustom,
  solanaHttp,
  solanaKeyPair,
  solanaWallet,
  type SolanaTransport,
} from '../../src/connections/solana.js'

async function secretKeyBytes(): Promise<Uint8Array> {
  const seed = new Uint8Array(32).fill(1)
  const { publicKey } = await createKeyPairFromPrivateKeyBytes(seed)
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey))
  return new Uint8Array([...seed, ...publicBytes])
}

describe('Solana bridge clients', () => {
  it('constructs a tagged client without network access and requires a transport', () => {
    const request = vi.fn()
    const transport: SolanaTransport = solanaCustom(request)
    expect(createSolanaClient({ transport }).family).toBe('solana')
    expect(request).not.toHaveBeenCalled()
    expect(() => createSolanaClient({} as never)).toThrow('Solana client requires a transport')
  })

  it('delegates Wallet Standard submission without public broadcasting', async () => {
    const signAndSendTransaction = vi.fn(async () => [{ signature: new Uint8Array([1, 2, 3]) }])
    const request = vi.fn(async () => 'unused')
    const client = createSolanaClient({
      transport: solanaCustom(request),
      account: solanaWallet({
        wallet: { features: { 'solana:signAndSendTransaction': { signAndSendTransaction } } },
        account: { address: 'Sender11111111111111111111111111111111111', publicKey: new Uint8Array(32) },
        chain: 'solana:mainnet',
      }),
    })

    expect(await client.walletClient?.sendTransaction(new Uint8Array([9]))).toEqual({ signature: 'Ldp' })
    expect(request).not.toHaveBeenCalled()
  })

  it('creates a local keypair without network access', async () => {
    const request = vi.fn()
    const client = createSolanaClient({
      transport: solanaCustom(request),
      account: solanaKeyPair(await secretKeyBytes()),
    })

    expect(await client.walletClient?.getAddress()).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    expect(request).not.toHaveBeenCalled()
  })

  it('preserves Solana simulation details when submission fails', async () => {
    const client = createSolanaClient({
      transport: solanaHttp('https://solana.example', {
        fetch: vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            error: {
              code: -32002,
              message: 'Transaction simulation failed',
              data: {
                err: { InstructionError: [0, 'Custom'] },
                logs: ['Program log: insufficient lamports'],
              },
            },
          }),
        })),
      }),
    })

    await expect(client.publicClient.sendTransaction(new Uint8Array([1, 2, 3])))
      .rejects.toThrow(/insufficient lamports/)
  })

  it('adds the local fee-payer signature and broadcasts through the public transport', async () => {
    const secret = await secretKeyBytes()
    const signer = await createKeyPairSignerFromBytes(secret)
    let submitted: Uint8Array | undefined
    const request = vi.fn(async (method: string, params: unknown[]) => {
      if (method !== 'sendTransaction') throw new Error(`unexpected ${method}`)
      submitted = Uint8Array.from(atob((params[0] as string)), (character) => character.charCodeAt(0))
      return 'submitted-signature'
    })
    const client = createSolanaClient({
      transport: solanaCustom(request),
      account: solanaKeyPair(secret),
    })
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (transaction) => setTransactionMessageFeePayer(address(signer.address), transaction),
      (transaction) => setTransactionMessageLifetimeUsingBlockhash({
        blockhash: blockhash(signer.address),
        lastValidBlockHeight: 100n,
      }, transaction),
    )
    const wire = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)))

    await expect(client.walletClient?.sendTransaction(wire)).resolves.toEqual({ signature: 'submitted-signature' })
    expect(request).toHaveBeenCalledWith('sendTransaction', expect.any(Array))
    const signed = getTransactionDecoder().decode(submitted!)
    expect(signed.signatures[signer.address]).toBeInstanceOf(Uint8Array)
  })
})
