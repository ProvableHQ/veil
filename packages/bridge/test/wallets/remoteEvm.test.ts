import { DynamicEvmWalletClient } from '@dynamic-labs-wallet/node-evm'
import { PrivyClient } from '@privy-io/node'
import { parseTransaction, recoverTransactionAddress, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it, vi } from 'vitest'
import { createPrivyEvmClient } from '../../src/privy/index.js'
import { createDynamicEvmClient } from '../../src/dynamic/index.js'
import { evmCustom } from '../../src/connections/evm.js'

const signer = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const to = '0x0000000000000000000000000000000000000002' as const
const hash = `0x${'ab'.repeat(32)}` as const

for (const provider of ['privy', 'dynamic'] as const) {
  describe(`${provider} remote EVM`, () => {
    async function setup(failSigning = false) {
      const signed: Hex[] = []
      const request = vi.fn(async ({ method, params }: { method: string; params?: unknown }) => {
        if (method === 'eth_chainId') return '0x1'
        if (method === 'eth_getTransactionCount') return '0x0'
        if (method === 'eth_estimateGas') return '0x5208'
        if (method === 'eth_gasPrice') return '0x3b9aca00'
        if (method === 'eth_getBlockByNumber') return { number: '0x1', baseFeePerGas: null }
        if (method === 'eth_sendRawTransaction') { signed.push((params as Hex[])[0]!); return hash }
        throw new Error(`unexpected ${method}`)
      })
      const sign = vi.fn(async (tx: Parameters<typeof signer.signTransaction>[0]) => {
        if (failSigning) throw new Error('remote policy rejected signing')
        return signer.signTransaction(tx)
      })
      const transport = evmCustom(request)
      let client
      if (provider === 'privy') {
        const privy = new PrivyClient({ appId: 'test-app', appSecret: 'test-secret', maxRetries: 0,
          fetch: async (input, init) => {
            expect(String(input)).toContain('/wallets/evm-wallet/rpc')
            const body = JSON.parse(init!.body as string)
            expect(body.method).toBe('eth_signTransaction')
            const tx = body.params.transaction
            const signed_transaction = await sign({
              type: 'legacy', chainId: Number(tx.chain_id), nonce: tx.nonce ?? 0,
              to: tx.to, data: tx.data, value: BigInt(tx.value), gas: BigInt(tx.gas_limit), gasPrice: BigInt(tx.gas_price),
            })
            return Response.json({ method: 'eth_signTransaction', data: { signed_transaction, encoding: 'hex' } })
          },
        })
        client = await createPrivyEvmClient({ client: privy, walletId: 'evm-wallet', address: signer.address, transport })
      } else {
        const dynamic = new DynamicEvmWalletClient({ environmentId: 'test-environment' })
        vi.spyOn(dynamic, 'signTransaction').mockImplementation(async params => {
          expect(params.walletMetadata.accountAddress).toBe(signer.address)
          expect(params.password).toBe('test-password')
          return sign(params.transaction)
        })
        client = await createDynamicEvmClient({
          client: dynamic,
          walletMetadata: { walletId: 'evm-wallet', accountAddress: signer.address, chainName: 'EVM', thresholdSignatureScheme: 'TWO_OF_TWO' } as never,
          password: 'test-password', transport,
        })
      }
      return { client, sign, request, signed }
    }

    it('signs remotely and broadcasts the prepared transaction through the supplied RPC', async () => {
      const f = await setup()
      expect(await f.client.walletClient!.getAddress()).toBe(signer.address)
      expect(f.sign).not.toHaveBeenCalled()
      expect(f.request).not.toHaveBeenCalled()
      await expect(f.client.walletClient!.sendTransaction({ chainId: 1, from: signer.address, to, data: '0x1234', value: 123n })).resolves.toBe(hash)
      expect(f.sign).toHaveBeenCalledOnce()
      expect(f.signed).toHaveLength(1)
      expect(parseTransaction(f.signed[0]!)).toMatchObject({ chainId: 1, to, data: '0x1234', value: 123n })
      expect(await recoverTransactionAddress({ serializedTransaction: f.signed[0]! })).toBe(signer.address)
    })

    it.each(['chain', 'sender'] as const)('rejects a mismatched %s before remote signing', async mismatch => {
      const f = await setup()
      await expect(f.client.walletClient!.sendTransaction({ chainId: mismatch === 'chain' ? 2 : 1, from: mismatch === 'sender' ? to : signer.address, to, data: '0x' })).rejects.toThrow(/expected|does not match/)
      expect(f.sign).not.toHaveBeenCalled()
      expect(f.signed).toHaveLength(0)
    })

    it('does not broadcast when remote signing fails', async () => {
      const f = await setup(true)
      await expect(f.client.walletClient!.sendTransaction({ chainId: 1, to, data: '0x', value: 1n })).rejects.toThrow()
      expect(f.sign).toHaveBeenCalledOnce()
      expect(f.signed).toHaveLength(0)
    })
  })
}
