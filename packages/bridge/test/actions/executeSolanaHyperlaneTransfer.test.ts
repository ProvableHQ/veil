import { getTransactionDecoder } from '@solana/kit'
import { describe, expect, it, vi } from 'vitest'
import { execute as executeSolanaHyperlaneTransfer } from '../../src/protocols/hyperlane/solana.js'
import { getStatus } from '../../src/actions/getStatus.js'
import { recover } from '../../src/actions/recover.js'
import { BridgeError } from '../../src/errors/bridgeErrors.js'
import type { SolanaRpcClient } from '../../src/solana/rpc.js'
import type { SolanaWalletClient } from '../../src/connections/solana.js'
import type { SolanaClient } from '../../src/connections/solana.js'
import type { BridgeReceipt } from '../../src/types/protocol.js'
import {
  WARP_PROGRAM_ADDRESS,
  igpAccountData,
  registryWithRoute,
  transferFixture,
  transferPlan,
} from '../fixtures/solanaHyperlane.js'

const STUB_SIGNATURE = 'stub-signature'

// A well-formed 32-byte pubkey that is neither the fixture's recorded sender
// nor any program or account the transfer instruction touches, so it is a
// legal fee payer in its own right.
const OTHER_SENDER = '11111111111111111111111111111112'

function stubExecutor(
  options: { onSend?: (wireTransaction: Uint8Array) => void; address?: string } = {},
): SolanaWalletClient {
  return {
    getAddress: async () => options.address ?? transferFixture.senderAddress,
    sendTransaction: async (wireTransaction) => {
      options.onSend?.(wireTransaction)
      return { signature: STUB_SIGNATURE }
    },
  }
}

function executeRpc(overrides: Partial<SolanaRpcClient> = {}): SolanaRpcClient {
  return {
    getLatestBlockhash: async () => ({ blockhash: WARP_PROGRAM_ADDRESS, lastValidBlockHeight: 100n }),
    getBlockHeight: async () => 1n,
    getBalance: async () => 800_000_000_000n,
    getAccountData: async () => igpAccountData(),
    getFeeForMessage: async () => 10_000n,
    getMinimumBalanceForRentExemption: async (dataLength) => {
      if (dataLength === 141) return 1_872_240n
      if (dataLength === 194) return 2_241_120n
      return 890_880n
    },
    getSignatureStatus: async () => 'confirmed',
    getTransactionLogs: async () => transferFixture.logMessages,
    ...overrides,
  }
}

function client(executor: SolanaWalletClient, publicClient: SolanaRpcClient): SolanaClient & { walletClient: SolanaWalletClient } {
  return {
    family: 'solana',
    publicClient: { ...publicClient, sendTransaction: async () => ({ signature: 'unused' }) },
    walletClient: executor,
  }
}

describe('executeSolanaHyperlaneTransfer', () => {
  it('signs, submits, confirms, and extracts the Hyperlane message id', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    let capturedWire: Uint8Array | undefined
    const executor = stubExecutor({ onSend: (wire) => { capturedWire = wire } })
    const rpc = executeRpc()

    const execution = await executeSolanaHyperlaneTransfer(registry, client(executor, rpc), { plan })

    expect(execution.receipt.status).toBe('DELIVERY_PENDING')
    expect(execution.receipt.sourceTxId).toBe(STUB_SIGNATURE)
    expect(execution.receipt.messageId).toBe(
      '0xffe0409d00c184769b4dfa2a1eaac5a0a79bfe52458a38e1d9a71a9e5c677805',
    )
    expect(execution.receipt.id).toBe(execution.receipt.messageId)

    // The wire bytes handed to the executor already carry exactly
    // one signature — the unique message account's — proving the action
    // partially signs with the ephemeral keypair before dispatch.
    expect(capturedWire).toBeInstanceOf(Uint8Array)
    const decoded = getTransactionDecoder().decode(capturedWire!)
    const signedEntries = Object.entries(decoded.signatures).filter(([, signature]) => signature !== null)
    expect(signedEntries).toHaveLength(1)
    expect(signedEntries[0]?.[0]).toBe(execution.receipt.protocolState.uniqueMessageAddress)
  })

  it('refuses to execute a plan prepared for a different sender than the connected account', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    const executor = stubExecutor({ address: OTHER_SENDER })
    const getBalance = vi.fn(async () => 800_000_000_000n)
    const rpc = executeRpc({ getBalance })

    await expect(executeSolanaHyperlaneTransfer(registry, client(executor, rpc), { plan })).rejects.toThrow(
      new RegExp(`Prepared sender ${transferFixture.senderAddress} does not match connected account ${OTHER_SENDER}`),
    )
    // The mismatch is caught before any balance read or transaction assembly.
    expect(getBalance).not.toHaveBeenCalled()
  })

  it('executes a plan with no sender against whichever account the executor holds', async () => {
    const registry = registryWithRoute()
    const { sender: _sender, ...plan } = transferPlan(registry)
    const executor = stubExecutor({ address: OTHER_SENDER })
    const rpc = executeRpc()

    const execution = await executeSolanaHyperlaneTransfer(registry, client(executor, rpc), { plan })

    expect(execution.receipt.status).toBe('DELIVERY_PENDING')
  })

  it('throws a BridgeError describing the amount, gas, and rent split when balance is insufficient', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    const executor = stubExecutor()
    const rpc = executeRpc({ getBalance: async () => 0n })

    try {
      await executeSolanaHyperlaneTransfer(registry, client(executor, rpc), { plan })
      expect.unreachable('expected an insufficient-balance BridgeError')
    } catch (error) {
      expect(error).toBeInstanceOf(BridgeError)
      const message = (error as BridgeError).message
      expect(message).toContain('balance 0 lamports')
      expect(message).toContain('amount 676200000000')
      expect(message).toContain('gas 2910000')
      expect(message).toContain('rent 5004240')
    }
  })

  it('throws a BridgeError naming the signature when the network reports failure', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    const executor = stubExecutor()
    const rpc = executeRpc({ getSignatureStatus: async () => 'failed' })

    await expect(executeSolanaHyperlaneTransfer(registry, client(executor, rpc), { plan })).rejects.toThrow(
      new RegExp(STUB_SIGNATURE),
    )
  })

  it('returns a resumable SOURCE_CONFIRMING receipt on confirmation timeout, without throwing', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    const executor = stubExecutor()
    const rpc = executeRpc({ getSignatureStatus: async () => null })

    const execution = await executeSolanaHyperlaneTransfer(registry, client(executor, rpc), {
      plan,
      confirmationTimeoutMs: 0,
    })

    expect(execution.receipt.status).toBe('SOURCE_CONFIRMING')
    expect(execution.receipt.sourceTxId).toBe(STUB_SIGNATURE)
    expect(execution.receipt.messageId).toBeUndefined()
    expect(execution.receipt.id).toBe(STUB_SIGNATURE)
    expect(execution.receipt.protocolState.blockhash).toBe(WARP_PROGRAM_ADDRESS)
    expect(execution.receipt.protocolState.lastValidBlockHeight).toBe('100')
  })

  it('returns resumable expired state without resubmitting after blockhash expiry', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    let submissions = 0
    const executor = stubExecutor({ onSend: () => { submissions += 1 } })
    const rpc = executeRpc({ getSignatureStatus: async () => null, getBlockHeight: async () => 101n })

    const execution = await executeSolanaHyperlaneTransfer(registry, client(executor, rpc), { plan })

    expect(execution.receipt.status).toBe('SOURCE_CONFIRMING')
    expect(execution.receipt.protocolState.blockhashExpired).toBe(true)
    expect(submissions).toBe(1)
  })

  it('resumes a checkpointed signature without signing or submitting again', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    let submissions = 0
    const receipt: BridgeReceipt = {
      id: STUB_SIGNATURE,
      protocol: 'hyperlane',
      status: 'SOURCE_CONFIRMING',
      sourceTxId: STUB_SIGNATURE,
      protocolState: {
        routeId: plan.route.id,
        destinationDomain: 1634493807,
        blockhash: WARP_PROGRAM_ADDRESS,
        lastValidBlockHeight: '100',
        uniqueMessageAddress: OTHER_SENDER,
        quotedLamports: '676207023360',
      },
    }

    const execution = await executeSolanaHyperlaneTransfer(
      registry,
      client(stubExecutor({ onSend: () => { submissions += 1 } }), executeRpc()),
      { plan, resume: receipt },
    )

    expect(submissions).toBe(0)
    expect(execution.receipt).toMatchObject({
      id: '0xffe0409d00c184769b4dfa2a1eaac5a0a79bfe52458a38e1d9a71a9e5c677805',
      protocol: 'hyperlane',
      status: 'DELIVERY_PENDING',
      sourceTxId: STUB_SIGNATURE,
      messageId: '0xffe0409d00c184769b4dfa2a1eaac5a0a79bfe52458a38e1d9a71a9e5c677805',
    })
  })

  it('confirms a submitted signature through the read-only status action', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    const receipt: BridgeReceipt = {
      id: STUB_SIGNATURE,
      protocol: 'hyperlane',
      status: 'SOURCE_CONFIRMING',
      sourceTxId: STUB_SIGNATURE,
      protocolState: { routeId: plan.route.id },
    }

    const result = await getStatus(
      registry,
      { solana: client(stubExecutor(), executeRpc()) },
      globalThis.fetch,
      { plan, receipt },
    )

    expect(result).toMatchObject({
      status: 'DELIVERY_PENDING',
      sourceTxId: STUB_SIGNATURE,
      messageId: '0xffe0409d00c184769b4dfa2a1eaac5a0a79bfe52458a38e1d9a71a9e5c677805',
    })
  })

  it('recovers a submitted signature from a compact checkpoint', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)

    const result = await recover(
      registry,
      { solana: client(stubExecutor(), executeRpc()) },
      globalThis.fetch,
      {
        plan,
        checkpoint: {
          version: 1,
          routeId: plan.route.id,
          protocol: 'hyperlane',
          source: { transactionId: STUB_SIGNATURE },
        },
      },
    )

    expect(result).toMatchObject({
      status: 'DELIVERY_PENDING',
      sourceTxId: STUB_SIGNATURE,
      messageId: '0xffe0409d00c184769b4dfa2a1eaac5a0a79bfe52458a38e1d9a71a9e5c677805',
    })
  })

  it('rejects a resume receipt checkpointed for another route', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    const receipt: BridgeReceipt = {
      id: STUB_SIGNATURE,
      protocol: 'hyperlane',
      status: 'SOURCE_CONFIRMING',
      sourceTxId: STUB_SIGNATURE,
      protocolState: {
        source: { chain: 'other', asset: 'sol' },
      destination: { chain: 'aleo', asset: 'sol' },
        destinationDomain: 1634493807,
        blockhash: WARP_PROGRAM_ADDRESS,
        lastValidBlockHeight: '100',
      },
    }

    await expect(executeSolanaHyperlaneTransfer(
      registry,
      client(stubExecutor(), executeRpc()),
      { plan, resume: receipt },
    )).rejects.toThrow(/does not match the prepared route/)
  })

  it('checkpoints the signature and lifetime before confirmation polling', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    const checkpoints: BridgeReceipt[] = []
    const rpc = executeRpc()

    await executeSolanaHyperlaneTransfer(registry, client(stubExecutor(), rpc), {
      plan,
      onSubmitted(receipt) { checkpoints.push(receipt) },
    })

    expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0]).toMatchObject({
      status: 'SOURCE_CONFIRMING',
      sourceTxId: STUB_SIGNATURE,
      protocolState: { blockhash: WARP_PROGRAM_ADDRESS, lastValidBlockHeight: '100' },
    })
  })

  it('tolerates transient getSignatureStatus errors and succeeds once the status resolves', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    const executor = stubExecutor()
    let calls = 0
    const rpc = executeRpc({
      getSignatureStatus: async () => {
        calls += 1
        if (calls <= 2) throw new Error('transient RPC error')
        return 'confirmed'
      },
    })

    const execution = await executeSolanaHyperlaneTransfer(registry, client(executor, rpc), {
      plan,
      pollingIntervalMs: 0,
      confirmationTimeoutMs: 2_000,
    })

    expect(execution.receipt.status).toBe('DELIVERY_PENDING')
    expect(execution.receipt.sourceTxId).toBe(STUB_SIGNATURE)
    expect(calls).toBeGreaterThanOrEqual(3)
  })

  it('returns a resumable SOURCE_CONFIRMING receipt, without throwing, when status-read errors persist until the timeout', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    const executor = stubExecutor()
    const rpc = executeRpc({
      getSignatureStatus: async () => { throw new Error('persistent RPC error') },
    })

    const execution = await executeSolanaHyperlaneTransfer(registry, client(executor, rpc), {
      plan,
      confirmationTimeoutMs: 0,
    })

    expect(execution.receipt.status).toBe('SOURCE_CONFIRMING')
    expect(execution.receipt.sourceTxId).toBe(STUB_SIGNATURE)
  })
})
