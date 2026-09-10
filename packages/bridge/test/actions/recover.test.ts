import { describe, expect, it } from 'vitest'
import { createBridgeClient } from '../../src/clients/createBridgeClient.js'
import { createBridgeCheckpoint } from '../../src/actions/createBridgeCheckpoint.js'
import { prepare } from '../../src/actions/prepare.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import type { BridgeReceipt } from '../../src/types/protocol.js'

const RECIPIENT = 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n'
const APPROVAL_TX_ID = `0x${'11'.repeat(32)}`
const SOURCE_TX_ID = `0x${'22'.repeat(32)}`
const DESTINATION_TX_ID = 'at1destination'

function plan() {
  return prepare(DEFAULT_BRIDGE_REGISTRY, {
    source: { chain: 'sepolia', asset: 'usdc' },
    destination: { chain: 'aleo-testnet', asset: 'usdcx' },
    amount: '2',
    recipient: RECIPIENT,
    mintMode: 'private',
  })
}

describe('bridge recovery checkpoints', () => {
  it('exposes recover as a protocol-neutral client action', () => {
    const client = createBridgeClient()
    expect(client.recover).toBeTypeOf('function')
    expect(client.resume).toBeTypeOf('function')
    expect(client.wait).toBeTypeOf('function')
  })

  it('persists the public transfer intent with transaction identifiers', () => {
    const transferPlan = plan()
    const receipt: BridgeReceipt = {
      id: DESTINATION_TX_ID,
      protocol: 'xreserve',
      status: 'DESTINATION_CONFIRMING',
      sourceTxId: SOURCE_TX_ID,
      destinationTxId: DESTINATION_TX_ID,
      protocolState: {
        routeId: transferPlan.route.id,
        approvalTxIds: [APPROVAL_TX_ID],
        payload: 'large protocol data must not be persisted',
      },
    }

    expect(createBridgeCheckpoint(transferPlan, receipt)).toEqual({
      version: 1,
      intent: {
        source: { chain: 'sepolia', asset: 'usdc' },
        destination: { chain: 'aleo-testnet', asset: 'usdcx' },
        bridgeProtocol: 'xreserve',
        amount: '2',
        recipient: RECIPIENT,
        mintMode: 'private',
      },
      route: {
        id: transferPlan.route.id,
        registryVersion: transferPlan.registryVersion,
      },
      source: {
        approvalTransactionIds: [APPROVAL_TX_ID],
        transactionId: SOURCE_TX_ID,
      },
      destination: { transactionId: DESTINATION_TX_ID },
    })
  })

  it('rejects receipts that do not belong to the prepared route', () => {
    const transferPlan = plan()
    const receipt: BridgeReceipt = {
      id: SOURCE_TX_ID,
      protocol: 'xreserve',
      status: 'SOURCE_CONFIRMING',
      sourceTxId: SOURCE_TX_ID,
      protocolState: { routeId: 'xreserve:wrong/route' },
    }

    expect(() => createBridgeCheckpoint(transferPlan, receipt)).toThrow(/does not match/)
  })
})
