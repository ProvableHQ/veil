import { getTransactionDecoder } from '@solana/kit'
import { describe, expect, it, vi } from 'vitest'
import { executeSolanaHyperlaneTransfer } from '../../src/actions/executeSolanaHyperlaneTransfer.js'
import { BridgeError } from '../../src/errors/bridgeErrors.js'
import type { SolanaRpcReader } from '../../src/solana/rpc.js'
import type { SolanaBridgeExecutor } from '../../src/types/solana.js'
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
): SolanaBridgeExecutor {
  return {
    getAddress: async () => options.address ?? transferFixture.senderAddress,
    signAndSendTransaction: async (wireTransaction) => {
      options.onSend?.(wireTransaction)
      return { signature: STUB_SIGNATURE }
    },
  }
}

function executeRpc(overrides: Partial<SolanaRpcReader> = {}): SolanaRpcReader {
  return {
    getLatestBlockhash: async () => ({ blockhash: WARP_PROGRAM_ADDRESS, lastValidBlockHeight: 100n }),
    getBalance: async () => 800_000_000_000n,
    getAccountData: async () => igpAccountData(),
    getSignatureStatus: async () => 'confirmed',
    getTransactionLogs: async () => transferFixture.logMessages,
    ...overrides,
  }
}

/**
 * Advances fake timers in small increments until the action settles. A single
 * large advance can race ahead of the real (non-timer) async work the action
 * does before it starts polling — key generation, PDA derivation, and
 * transaction signing — since advancing past a moment with no pending timer
 * resolves near-instantly and does not wait for that work.
 */
async function settleWithFakeTimers<T>(promise: Promise<T>): Promise<T> {
  let settled = false
  void promise.then(() => { settled = true }, () => { settled = true })
  for (let iteration = 0; iteration < 200 && !settled; iteration++) {
    await vi.advanceTimersByTimeAsync(100)
  }
  return promise
}

describe('executeSolanaHyperlaneTransfer', () => {
  it('signs, submits, confirms, and extracts the Hyperlane message id', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    let capturedWire: Uint8Array | undefined
    const executor = stubExecutor({ onSend: (wire) => { capturedWire = wire } })
    const rpc = executeRpc()

    const execution = await executeSolanaHyperlaneTransfer(registry, executor, rpc, { plan })

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

    await expect(executeSolanaHyperlaneTransfer(registry, executor, rpc, { plan })).rejects.toThrow(
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

    const execution = await executeSolanaHyperlaneTransfer(registry, executor, rpc, { plan })

    expect(execution.receipt.status).toBe('DELIVERY_PENDING')
  })

  it('throws a BridgeError describing the amount, gas, and rent split when balance is insufficient', async () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    const executor = stubExecutor()
    const rpc = executeRpc({ getBalance: async () => 0n })

    try {
      await executeSolanaHyperlaneTransfer(registry, executor, rpc, { plan })
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

    await expect(executeSolanaHyperlaneTransfer(registry, executor, rpc, { plan })).rejects.toThrow(
      new RegExp(STUB_SIGNATURE),
    )
  })

  it('returns a resumable SOURCE_CONFIRMING receipt on confirmation timeout, without throwing', async () => {
    vi.useFakeTimers()
    try {
      const registry = registryWithRoute()
      const plan = transferPlan(registry)
      const executor = stubExecutor()
      const rpc = executeRpc({ getSignatureStatus: async () => null })

      const execution = await settleWithFakeTimers(executeSolanaHyperlaneTransfer(registry, executor, rpc, {
        plan,
        pollingIntervalMs: 1_000,
        confirmationTimeoutMs: 3_000,
      }))

      expect(execution.receipt.status).toBe('SOURCE_CONFIRMING')
      expect(execution.receipt.sourceTxId).toBe(STUB_SIGNATURE)
      expect(execution.receipt.messageId).toBeUndefined()
      expect(execution.receipt.id).toBe(STUB_SIGNATURE)
    } finally {
      vi.useRealTimers()
    }
  })

  it('tolerates transient getSignatureStatus errors and succeeds once the status resolves', async () => {
    vi.useFakeTimers()
    try {
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

      const execution = await settleWithFakeTimers(executeSolanaHyperlaneTransfer(registry, executor, rpc, {
        plan,
        pollingIntervalMs: 1_000,
        confirmationTimeoutMs: 30_000,
      }))

      expect(execution.receipt.status).toBe('DELIVERY_PENDING')
      expect(execution.receipt.sourceTxId).toBe(STUB_SIGNATURE)
      expect(calls).toBeGreaterThanOrEqual(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns a resumable SOURCE_CONFIRMING receipt, without throwing, when status-read errors persist until the timeout', async () => {
    vi.useFakeTimers()
    try {
      const registry = registryWithRoute()
      const plan = transferPlan(registry)
      const executor = stubExecutor()
      const rpc = executeRpc({
        getSignatureStatus: async () => { throw new Error('persistent RPC error') },
      })

      const execution = await settleWithFakeTimers(executeSolanaHyperlaneTransfer(registry, executor, rpc, {
        plan,
        pollingIntervalMs: 1_000,
        confirmationTimeoutMs: 3_000,
      }))

      expect(execution.receipt.status).toBe('SOURCE_CONFIRMING')
      expect(execution.receipt.sourceTxId).toBe(STUB_SIGNATURE)
    } finally {
      vi.useRealTimers()
    }
  })
})
