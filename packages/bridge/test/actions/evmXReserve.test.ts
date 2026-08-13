import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  getAddress,
  parseAbi,
  type Address,
  type Hash,
  type Hex,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { executeEvmXReserveTransfer, getXReserveAttestation } from '../../src/actions/evmXReserve.js'
import { prepareTransfer } from '../../src/actions/prepareTransfer.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import type { EvmBridgeExecutor } from '../../src/types/evm.js'

const ACCOUNT = getAddress('0x0000000000000000000000000000000000000001')
const TOKEN = getAddress('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238')
const XRESERVE = getAddress('0x008888878f94C0d87defdf0B07f46B93C1934442')
const RECIPIENT = 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n'
const TX_HASH = `0x${'22'.repeat(32)}` as Hash
const ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function depositToRemote(uint256 value, uint32 remoteDomain, bytes32 remoteRecipient, address localToken, uint256 maxFee, bytes hookData)',
  'event DepositedToRemote(address indexed localToken, uint256 value, address indexed localDepositor, bytes32 indexed remoteRecipient, uint32 remoteDomain, bytes32 remoteToken, uint256 maxFee, bytes hookData)',
])

type Sent = { from: Address, to: Address, data: Hex, value?: Hex }

function transferPlan() {
  return prepareTransfer(DEFAULT_BRIDGE_REGISTRY, { routeId: 'xreserve:sepolia/usdc->aleo-testnet/usdcx', amount: '2', recipient: RECIPIENT, sender: ACCOUNT, mintMode: 'record' })
}

function mockExecutor() {
  const sent: Sent[] = []
  const executor: EvmBridgeExecutor = {
    account: ACCOUNT,
    request: async ({ method, params }) => {
      if (method === 'eth_chainId') return '0xaa36a7'
      if (method === 'eth_call') {
        const transaction = (params as readonly [{ data: Hex }])[0]
        const decoded = decodeFunctionData({ abi: ABI, data: transaction.data })
        if (decoded.functionName === 'balanceOf') return encodeFunctionResult({ abi: ABI, functionName: 'balanceOf', result: 3_000_000n })
        if (decoded.functionName === 'allowance') return encodeFunctionResult({ abi: ABI, functionName: 'allowance', result: 0n })
      }
      if (method === 'eth_sendTransaction') {
        sent.push((params as readonly [Sent])[0])
        return sent.length === 1 ? `0x${'11'.repeat(32)}` : TX_HASH
      }
      if (method === 'eth_getTransactionReceipt') {
        const hash = (params as readonly [Hash])[0]
        if (hash !== TX_HASH) return { status: '0x1', logs: [] }
        const deposit = decodeFunctionData({ abi: ABI, data: sent.at(-1)!.data })
        if (deposit.functionName !== 'depositToRemote') throw new Error('Expected deposit')
        const [value, remoteDomain, remoteRecipient, localToken, maxFee, hookData] = deposit.args
        return {
          status: '0x1',
          transactionHash: TX_HASH,
          logs: [{
            address: XRESERVE,
            logIndex: '0x3',
            topics: encodeEventTopics({ abi: ABI, eventName: 'DepositedToRemote', args: { localToken, localDepositor: ACCOUNT, remoteRecipient } }),
            data: encodeAbiParameters(
              [{ type: 'uint256' }, { type: 'uint32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'bytes' }],
              [value, remoteDomain, '0xb143ed52c774cd1d4a519d0e796f15916be5a9e1d45edcd9852dd23f68f53401', maxFee, hookData],
            ),
          }],
        }
      }
      throw new Error(`Unexpected RPC method ${method}`)
    },
  }
  return { executor, sent }
}

describe('Ethereum xReserve actions', () => {
  it('approves USDC, deposits without msg.value, and returns resumable attestation state', async () => {
    const { executor, sent } = mockExecutor()
    const execution = await executeEvmXReserveTransfer(DEFAULT_BRIDGE_REGISTRY, executor, { plan: transferPlan() })
    expect(sent).toHaveLength(2)
    expect(decodeFunctionData({ abi: ABI, data: sent[0]!.data })).toMatchObject({ functionName: 'approve', args: [XRESERVE, 2_000_000n] })
    expect(decodeFunctionData({ abi: ABI, data: sent[1]!.data })).toMatchObject({ functionName: 'depositToRemote' })
    expect(sent[1]!.value).toBeUndefined()
    expect(execution.receipt.status).toBe('ATTESTATION_PENDING')
    expect(execution.receipt.id).toMatch(/^0x[0-9a-f]{64}$/)
    expect(execution.receipt.protocolState.payload).toMatch(/^0x[0-9a-f]{610}$/)
    expect(execution.receipt.protocolState.mintMode).toBe('record')
  })

  it('maps an absent Circle attestation to pending', async () => {
    const result = await getXReserveAttestation(DEFAULT_BRIDGE_REGISTRY, async () => ({ ok: false, status: 404, json: async () => ({}) }), {
      routeId: transferPlan().route.id,
      messageHash: TX_HASH,
    })
    expect(result).toEqual({ status: 'pending', messageHash: TX_HASH })
  })
})
