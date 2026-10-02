import { DynamicSvmWalletClient } from '@dynamic-labs-wallet/node-svm'
import { PrivyClient } from '@privy-io/node'
import {
  AccountRole, address, appendTransactionMessageInstruction, blockhash,
  compileTransaction, createKeyPairSignerFromPrivateKeyBytes, createTransactionMessage,
  getTransactionDecoder, getTransactionEncoder, partiallySignTransaction, pipe,
  setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  signBytes,
} from '@solana/kit'
import bs58 from 'bs58'
import { describe, expect, it, vi } from 'vitest'
import { createPrivySolanaClient } from '../../src/privy/index.js'
import { createDynamicSolanaClient } from '../../src/dynamic/index.js'
import { solanaCustom } from '../../src/connections/solana.js'

async function fixture(version: 0 | 'legacy' = 0) {
  const payer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(1))
  const ephemeral = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(2))
  const message = pipe(
    createTransactionMessage({ version }),
    m => setTransactionMessageFeePayer(payer.address, m),
    m => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(payer.address), lastValidBlockHeight: 100n }, m),
    m => appendTransactionMessageInstruction({
      programAddress: address('11111111111111111111111111111111'),
      accounts: [{ address: ephemeral.address, role: AccountRole.READONLY_SIGNER }],
      data: new Uint8Array([1]),
    }, m),
  )
  const transaction = await partiallySignTransaction([ephemeral.keyPair], compileTransaction(message))
  const wire = new Uint8Array(getTransactionEncoder().encode(transaction))
  return { payer, ephemeral, transaction, wire }
}

for (const provider of ['privy', 'dynamic'] as const) {
  describe(`${provider} remote Solana`, () => {
    async function setup(options: { result?: 'bad-signature' | 'changed-message' | 'error'; version?: 0 | 'legacy' } = {}) {
      const f = await fixture(options.version)
      const failure = new Error('remote policy rejected signing')
      const sign = vi.fn(async (message: Uint8Array) => {
        if (options.result === 'error') throw failure
        return options.result === 'bad-signature' ? new Uint8Array(64) : signBytes(f.payer.keyPair.privateKey, message)
      })
      const request = vi.fn(async (method: string, params: unknown[]) => {
        expect(method).toBe('sendTransaction')
        const wire = Uint8Array.from(Buffer.from(params[0] as string, 'base64'))
        const submitted = getTransactionDecoder().decode(wire)
        expect(submitted.messageBytes).toEqual(f.transaction.messageBytes)
        expect(submitted.signatures[f.ephemeral.address]).toEqual(f.transaction.signatures[f.ephemeral.address])
        expect(submitted.signatures[f.payer.address]).toEqual(await signBytes(f.payer.keyPair.privateKey, f.transaction.messageBytes))
        return bs58.encode(submitted.signatures[f.payer.address]!)
      })
      const transport = solanaCustom(request)
      let client
      if (provider === 'privy') {
        const privy = new PrivyClient({
          appId: 'test-app', appSecret: 'test-secret', maxRetries: 0,
          fetch: async (_input, init) => {
            const body = JSON.parse(init!.body as string)
            expect(body.method).toBe('signTransaction')
            expect(body.chain_type).toBe('solana')
            const transaction = getTransactionDecoder().decode(Buffer.from(body.params.transaction, 'base64'))
            const messageBytes = new Uint8Array(transaction.messageBytes)
            if (options.result === 'changed-message') messageBytes[messageBytes.length - 1] = messageBytes[messageBytes.length - 1]! ^ 1
            const signature = await sign(messageBytes)
            // A remote response can omit pre-existing signatures. The bridge must retain them.
            const signed = { ...transaction, messageBytes, signatures: { ...transaction.signatures, [f.ephemeral.address]: null, [f.payer.address]: signature } }
            return Response.json({ method: 'signTransaction', data: {
              encoding: 'base64', signed_transaction: Buffer.from(getTransactionEncoder().encode(signed)).toString('base64'),
            } })
          },
        })
        client = await createPrivySolanaClient({ client: privy, walletId: 'sol-wallet', address: f.payer.address, transport })
      } else {
        const dynamic = new DynamicSvmWalletClient({ environmentId: 'test-environment' })
        vi.spyOn(dynamic, 'sign').mockImplementation(async params => {
          expect(params.walletMetadata.accountAddress).toBe(f.payer.address)
          expect(params.password).toBe('test-password')
          expect(params.context?.svmTransaction).toEqual({ chainId: '101', method: 'signAndSendTransaction', serializedTransactions: [bs58.encode(f.wire)] })
          const message = Uint8Array.from(Buffer.from(params.message, 'hex'))
          expect(message).toEqual(f.transaction.messageBytes)
          return sign(message)
        })
        client = await createDynamicSolanaClient({
          client: dynamic,
          walletMetadata: { walletId: 'sol-wallet', accountAddress: f.payer.address, chainName: 'SOL', thresholdSignatureScheme: 'TWO_OF_TWO', shareSetId: 'shares' } as never,
          password: 'test-password', chainId: '101', transport,
        })
      }
      return { ...f, client, sign, request, failure }
    }

    it.each([0, 'legacy'] as const)('preserves ephemeral signatures when remotely signing a %s transaction', async version => {
      const f = await setup({ version })
      expect(await f.client.walletClient!.getAddress()).toBe(f.payer.address)
      expect(f.sign).not.toHaveBeenCalled()
      expect(f.request).not.toHaveBeenCalled()
      await f.client.walletClient!.sendTransaction(f.wire)
      expect(f.sign).toHaveBeenCalledOnce()
      expect(f.request).toHaveBeenCalledOnce()
    })

    it('rejects a different fee payer before requesting a signature', async () => {
      const f = await setup()
      const other = compileTransaction(pipe(createTransactionMessage({ version: 0 }), m => setTransactionMessageFeePayer(f.ephemeral.address, m)))
      await expect(f.client.walletClient!.sendTransaction(new Uint8Array(getTransactionEncoder().encode(other)))).rejects.toThrow(/fee payer/i)
      expect(f.sign).not.toHaveBeenCalled()
      expect(f.request).not.toHaveBeenCalled()
    })

    it('rejects invalid signatures without broadcasting', async () => {
      const f = await setup({ result: 'bad-signature' })
      await expect(f.client.walletClient!.sendTransaction(f.wire)).rejects.toThrow(/signature/i)
      expect(f.request).not.toHaveBeenCalled()
    })

    it('propagates signing failures without retrying or broadcasting', async () => {
      const f = await setup({ result: 'error' })
      await expect(f.client.walletClient!.sendTransaction(f.wire)).rejects.toThrow()
      expect(f.sign).toHaveBeenCalledOnce()
      expect(f.request).not.toHaveBeenCalled()
    })

    if (provider === 'privy') it('rejects a remotely changed message before broadcasting', async () => {
      const f = await setup({ result: 'changed-message' })
      await expect(f.client.walletClient!.sendTransaction(f.wire)).rejects.toThrow(/message/i)
      expect(f.request).not.toHaveBeenCalled()
    })
  })
}
