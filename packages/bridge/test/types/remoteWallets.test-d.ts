import type { PrivyClient } from '@privy-io/node'
import type { DynamicEvmWalletClient } from '@dynamic-labs-wallet/node-evm'
import type { DynamicSvmWalletClient } from '@dynamic-labs-wallet/node-svm'
import { describe, expectTypeOf, it } from 'vitest'
import { createPrivyEvmClient, createPrivySolanaClient } from '@provablehq/aleo-bridge-sdk/privy'
import { createDynamicEvmClient, createDynamicSolanaClient } from '@provablehq/aleo-bridge-sdk/dynamic'
import { createBridgeClient, evmHttp, solanaHttp, type EvmClient, type SolanaClient } from '@provablehq/aleo-bridge-sdk'

declare const privy: PrivyClient
declare const dynamicEvm: DynamicEvmWalletClient
declare const dynamicSolana: DynamicSvmWalletClient
declare const walletMetadata: Parameters<DynamicEvmWalletClient['getWalletClient']>[0]['walletMetadata']

declare const ethereum: Awaited<ReturnType<typeof createPrivyEvmClient>>
declare const solana: Awaited<ReturnType<typeof createDynamicSolanaClient>>

describe('remote wallet public API', () => {
  it('accepts the published Privy SDK without consumer casts', () => {
    expectTypeOf(createPrivyEvmClient({ client: privy, walletId: 'wallet', address: '0x1234', transport: evmHttp('https://rpc.example') })).toEqualTypeOf<Promise<EvmClient>>()
    expectTypeOf(createPrivySolanaClient({ client: privy, walletId: 'wallet', address: 'address', transport: solanaHttp('https://rpc.example') })).toEqualTypeOf<Promise<SolanaClient>>()
  })
  it('accepts both published Dynamic SDK clients without consumer casts', () => {
    expectTypeOf(createDynamicEvmClient({ client: dynamicEvm, walletMetadata, transport: evmHttp('https://rpc.example') })).toEqualTypeOf<Promise<EvmClient>>()
    expectTypeOf(createDynamicSolanaClient({ client: dynamicSolana, walletMetadata, chainId: '101', transport: solanaHttp('https://rpc.example') })).toEqualTypeOf<Promise<SolanaClient>>()
  })
  it('returns capabilities accepted by the existing bridge client', () => {
    createBridgeClient({ clients: { ethereum, solana }, environment: 'mainnet' })
  })
  it('requires a public RPC and Dynamic policy network', () => {
    // @ts-expect-error A remote signer cannot supply public RPC reads.
    createPrivyEvmClient({ client: privy, walletId: 'wallet', address: '0x1234' })
    // @ts-expect-error Dynamic policy evaluation requires an explicit network.
    createDynamicSolanaClient({ client: dynamicSolana, walletMetadata, transport: solanaHttp('https://rpc.example') })
  })
})
