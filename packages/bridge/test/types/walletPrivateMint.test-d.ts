import { expectTypeOf, test } from 'vitest'
import type { TransactionInput } from '@provablehq/veil-core'
import {
  createBridgeClient,
  xreserve,
  type AleoWalletClient,
  type BridgePlan,
  type BridgeProgress,
  type BridgeReceipt,
  type WalletPreparedXReserveDeposit,
} from '../../src/index.js'
import type { EvmClient, EvmWalletClient } from '../../src/connections/evm.js'

declare const bridge: ReturnType<typeof createBridgeClient>
declare const plan: BridgePlan
declare const receipt: BridgeReceipt
declare const progress: Extract<BridgeProgress, { next: 'resume' }>
declare const evm: EvmClient & { walletClient: EvmWalletClient }
declare const aleo: AleoWalletClient

test('accepts AMM PR 920 wallet options throughout the public bridge lifecycle and standalone helpers', () => {
  const walletPreparedDeposit: WalletPreparedXReserveDeposit = {
    remoteRecipientBytes32: `0x${'22'.repeat(32)}`,
    hookData: `0x02${'33'.repeat(32)}${'00'.repeat(32)}`,
  }
  const privateMintNonceInput: TransactionInput = {
    type: 'derived', algorithm: 'shielded-usdcx-secret-nonce',
    args: {
      commitment: { type: 'string', value: '33'.repeat(32) },
      recipient: { type: 'address', value: plan.recipient },
    },
  }
  const options = { walletPreparedDeposit, privateMintNonceInput }
  expectTypeOf(bridge.quote({
    source: { chain: 'sepolia', asset: 'usdc' },
    destination: { chain: 'aleo-testnet', asset: 'usdcx' },
    amount: '2', recipient: plan.recipient, mintMode: 'private', circle: options,
  })).toMatchTypeOf<Promise<unknown>>()
  bridge.execute({ plan, circle: options })
  bridge.resume({ progress, circle: options })
  bridge.complete({ plan, receipt, circle: options })
  // Deprecated flat forms still compile for published callers.
  bridge.complete({ plan, receipt, privateMintSecretNonce: '7scalar' })
  bridge.recover({ checkpoint: {} as never, cctp: { approvalReplacement: { originalTransactionId: '0x', replacementTransactionId: '0x' } } })
  bridge.recover({ checkpoint: {} as never, circle: { approvalReplacement: { originalTransactionId: '0x', replacementTransactionId: '0x' } } })
  // @ts-expect-error the identity store is not a protocol-level option
  xreserve.evmToAleo.quote(evm, { plan, circle: options })
  xreserve.evmToAleo.quote(evm, { plan, ...options })
  xreserve.evmToAleo.execute(evm, { plan, ...options })
  xreserve.evmToAleo.complete(aleo, {
    plan, deposit: receipt,
    attestation: {
      status: 'complete', messageHash: `0x${'44'.repeat(32)}`,
      payload: `0x${'00'.repeat(305)}`, attestation: `0x${'11'.repeat(65)}`,
    },
    ...options,
  })
})
