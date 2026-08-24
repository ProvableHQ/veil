import { describe, expect, it, vi } from 'vitest'
import { executeXReservePrivateMint } from '../../src/actions/xreservePrivateMint.js'
import { prepareTransfer } from '../../src/actions/prepareTransfer.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import type { AleoBridgeExecutor } from '../../src/types/aleo.js'
import type { BridgeTransferReceipt } from '../../src/types/protocol.js'
import { buildXReserveHookData, calculateXReserveMessageHash } from '../../src/utils/xreserve.js'

const RECIPIENT = 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n'
const PAYLOAD = `0x${'00'.repeat(305)}` as const
const SIGNATURE = `0x${'11'.repeat(65)}` as const
const MESSAGE_HASH = calculateXReserveMessageHash(PAYLOAD)

describe('xReserve private mint', () => {
  it('submits only private_mint with the wrapper input order and plan scalar', async () => {
    const plan = prepareTransfer(DEFAULT_BRIDGE_REGISTRY, {
      routeId: 'xreserve:sepolia/usdc->aleo-testnet/usdcx',
      amount: '2',
      recipient: RECIPIENT,
      mintMode: 'private',
      privateMintSecretNonce: '7scalar',
    })
    const hookData = await buildXReserveHookData('private', RECIPIENT, 'testnet', '7scalar')
    const payload = `0x${'00'.repeat(240)}${hookData.slice(2)}` as const
    const messageHash = calculateXReserveMessageHash(payload)
    const deposit: BridgeTransferReceipt = {
      id: messageHash,
      protocol: 'xreserve',
      status: 'ATTESTATION_PENDING',
      sourceTxId: `0x${'22'.repeat(32)}`,
      protocolState: {
        routeId: plan.route.id,
        mintMode: 'private',
        intendedRecipient: RECIPIENT,
        payload,
        messageHash,
      },
    }
    const executeTransaction = vi.fn<AleoBridgeExecutor['executeTransaction']>()
      .mockResolvedValue({ transactionId: 'at1private' })

    const result = await executeXReservePrivateMint(DEFAULT_BRIDGE_REGISTRY, { executeTransaction }, {
      plan,
      deposit,
      attestation: { status: 'complete', messageHash, payload, attestation: SIGNATURE },
    })

    expect(executeTransaction).toHaveBeenCalledOnce()
    const call = executeTransaction.mock.calls[0]![0]
    expect(call.program).toBe('shielded_usdcx_wrapper.aleo')
    expect(call.function).toBe('private_mint')
    expect(call.inputs).toHaveLength(5)
    expect(call.inputs[3]).toBe('7scalar')
    expect(call.inputs[4]).toBe(RECIPIENT)
    expect(result.receipt.status).toBe('DESTINATION_CONFIRMING')
    expect(result.receipt.destinationTxId).toBe('at1private')
    expect(result.receipt.protocolState.secretNonce).toBe('7scalar')
  })

  it('rejects public and record plans before prompting the wallet', async () => {
    const plan = prepareTransfer(DEFAULT_BRIDGE_REGISTRY, {
      routeId: 'xreserve:sepolia/usdc->aleo-testnet/usdcx',
      amount: '2',
      recipient: RECIPIENT,
      mintMode: 'record',
    })
    const executeTransaction = vi.fn<AleoBridgeExecutor['executeTransaction']>()
    await expect(executeXReservePrivateMint(DEFAULT_BRIDGE_REGISTRY, { executeTransaction }, {
      plan,
      deposit: { id: MESSAGE_HASH, protocol: 'xreserve', status: 'ATTESTATION_PENDING', protocolState: {} },
      attestation: { status: 'complete', messageHash: MESSAGE_HASH, payload: PAYLOAD, attestation: SIGNATURE },
    })).rejects.toThrow(/private xReserve/)
    expect(executeTransaction).not.toHaveBeenCalled()
  })

  it('rejects a secret nonce that does not reproduce the attested hook', async () => {
    const plan = prepareTransfer(DEFAULT_BRIDGE_REGISTRY, {
      routeId: 'xreserve:sepolia/usdc->aleo-testnet/usdcx',
      amount: '2',
      recipient: RECIPIENT,
      mintMode: 'private',
      privateMintSecretNonce: '8scalar',
    })
    const hookData = await buildXReserveHookData('private', RECIPIENT, 'testnet', '7scalar')
    const payload = `0x${'00'.repeat(240)}${hookData.slice(2)}` as const
    const messageHash = calculateXReserveMessageHash(payload)
    const executeTransaction = vi.fn<AleoBridgeExecutor['executeTransaction']>()

    await expect(executeXReservePrivateMint(DEFAULT_BRIDGE_REGISTRY, { executeTransaction }, {
      plan,
      deposit: {
        id: messageHash,
        protocol: 'xreserve',
        status: 'ATTESTATION_PENDING',
        protocolState: {
          routeId: plan.route.id,
          mintMode: 'private',
          intendedRecipient: RECIPIENT,
          payload,
          messageHash,
        },
      },
      attestation: { status: 'complete', messageHash, payload, attestation: SIGNATURE },
    })).rejects.toThrow(/do not match the attested hook/)
    expect(executeTransaction).not.toHaveBeenCalled()
  })
})
