import {
  decodeFunctionData,
  encodeEventTopics,
  encodeFunctionResult,
  getAddress,
  parseAbi,
  zeroAddress,
  type Address,
  type Hash,
  type Hex,
} from 'viem'
import { describe, expect, it } from 'vitest'
import {
  executeEvmHyperlaneTransfer,
  quoteEvmHyperlaneTransfer,
} from '../../src/actions/evmHyperlane.js'
import { prepareTransfer } from '../../src/actions/prepareTransfer.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import type { EvmBridgeExecutor } from '../../src/types/evm.js'

const ACCOUNT = getAddress('0x0000000000000000000000000000000000000001')
const RECIPIENT = '0x20e3629764d5338f74bee96675801b1fb29d1fc68b177668f9175708bef84311'
const MESSAGE_ID = `0x${'ab'.repeat(32)}` as Hash
const WBTC = getAddress('0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599')
const USDT = getAddress('0xdAC17F958D2ee523a2206206994597C13D831ec7')
const ABI = parseAbi([
  'function quoteTransferRemote(uint32 destination, bytes32 recipient, uint256 amount) view returns ((address token, uint256 amount)[] quotes)',
  'function transferRemote(uint32 destination, bytes32 recipient, uint256 amount) payable returns (bytes32 messageId)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'event DispatchId(bytes32 indexed messageId)',
])

type SentTransaction = {
  from: Address
  to: Address
  data: Hex
  value?: Hex | undefined
}

function plan(routeId: string, amount: string) {
  return prepareTransfer(DEFAULT_BRIDGE_REGISTRY, {
    routeId,
    amount,
    recipient: `aleo1${'a'.repeat(58)}`,
    sender: ACCOUNT,
  })
}

function executor(options: {
  token?: Address | undefined
  amount: bigint
  nativeValue: bigint
  allowance?: bigint | undefined
  receipt?: 'confirmed' | 'pending' | undefined
  chainId?: number | undefined
}) {
  const sent: SentTransaction[] = []
  const hashes: Hash[] = []
  const bridgeExecutor: EvmBridgeExecutor = {
    account: ACCOUNT,
    request: async ({ method, params }) => {
      if (method === 'eth_chainId') return `0x${(options.chainId ?? 1).toString(16)}`
      if (method === 'eth_call') {
        const call = (params as readonly [{ to: Address, data: Hex }])[0]
        const decoded = decodeFunctionData({ abi: ABI, data: call.data })
        if (decoded.functionName === 'quoteTransferRemote') {
          return encodeFunctionResult({
            abi: ABI,
            functionName: 'quoteTransferRemote',
            result: options.token
              ? [
                  { token: zeroAddress, amount: options.nativeValue },
                  { token: options.token, amount: options.amount },
                ]
              : [{ token: zeroAddress, amount: options.nativeValue }],
          })
        }
        if (decoded.functionName === 'allowance') {
          return encodeFunctionResult({
            abi: ABI,
            functionName: 'allowance',
            result: options.allowance ?? 0n,
          })
        }
        throw new Error(`Unexpected eth_call ${decoded.functionName}`)
      }
      if (method === 'eth_sendTransaction') {
        sent.push((params as readonly [SentTransaction])[0])
        const hash = `0x${(sent.length).toString(16).padStart(64, '0')}` as Hash
        hashes.push(hash)
        return hash
      }
      if (method === 'eth_getTransactionReceipt') {
        if (options.receipt === 'pending') return null
        const hash = (params as readonly [Hash])[0]
        const isLast = hash === hashes.at(-1)
        return {
          status: '0x1',
          logs: isLast && sent.at(-1)?.to.toLowerCase() !== options.token?.toLowerCase()
            ? [{ data: '0x', topics: encodeEventTopics({ abi: ABI, eventName: 'DispatchId', args: { messageId: MESSAGE_ID } }) }]
            : [],
        }
      }
      throw new Error(`Unexpected RPC method ${method}`)
    },
  }
  return { bridgeExecutor, sent }
}

describe('Ethereum Hyperlane actions', () => {
  it('quotes and dispatches native ETH without an approval', async () => {
    const transferPlan = plan('hyperlane:ethereum/eth->aleo/eth', '0.0000000000000001')
    const { bridgeExecutor, sent } = executor({ amount: 100n, nativeValue: 69_000_000_000_101n })

    const quote = await quoteEvmHyperlaneTransfer(DEFAULT_BRIDGE_REGISTRY, bridgeExecutor, {
      plan: transferPlan,
      recipientBytes32: RECIPIENT,
    })
    expect(quote.amountAtomic).toBe(100n)
    expect(quote.nativeFeeAtomic).toBe(69_000_000_000_001n)

    const result = await executeEvmHyperlaneTransfer(DEFAULT_BRIDGE_REGISTRY, bridgeExecutor, {
      plan: transferPlan,
      recipientBytes32: RECIPIENT,
    })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.value).toBe('0x3ec1507d5065')
    expect(decodeFunctionData({ abi: ABI, data: sent[0]!.data }).functionName).toBe('transferRemote')
    expect(result.receipt.status).toBe('DELIVERY_PENDING')
    expect(result.receipt.messageId).toBe(MESSAGE_ID)
  })

  it('approves WBTC before transferRemote when allowance is insufficient', async () => {
    const transferPlan = plan('hyperlane:ethereum/wbtc->aleo/wbtc', '0.001')
    const { bridgeExecutor, sent } = executor({
      token: WBTC,
      amount: 100_000n,
      nativeValue: 50_000n,
      allowance: 0n,
    })

    const result = await executeEvmHyperlaneTransfer(DEFAULT_BRIDGE_REGISTRY, bridgeExecutor, {
      plan: transferPlan,
      recipientBytes32: RECIPIENT,
    })

    expect(sent).toHaveLength(2)
    expect(sent[0]!.to).toBe(WBTC)
    expect(decodeFunctionData({ abi: ABI, data: sent[0]!.data })).toMatchObject({
      functionName: 'approve',
      args: [getAddress('0x20CDC85778b732073F7EecEF3DF25c0d310f8772'), 100_000n],
    })
    expect(decodeFunctionData({ abi: ABI, data: sent[1]!.data })).toMatchObject({
      functionName: 'transferRemote',
      args: [1_634_493_807, RECIPIENT, 100_000n],
    })
    expect(sent[1]!.value).toBe('0xc350')
    expect(result.approvalTxIds).toHaveLength(1)
  })

  it('resets a non-zero USDT allowance before setting the required amount', async () => {
    const transferPlan = plan('hyperlane:ethereum/usdt->aleo/usdt', '1')
    const { bridgeExecutor, sent } = executor({
      token: USDT,
      amount: 1_000_000n,
      nativeValue: 50_000n,
      allowance: 1n,
    })

    await executeEvmHyperlaneTransfer(DEFAULT_BRIDGE_REGISTRY, bridgeExecutor, {
      plan: transferPlan,
      recipientBytes32: RECIPIENT,
    })

    expect(sent).toHaveLength(3)
    expect(decodeFunctionData({ abi: ABI, data: sent[0]!.data })).toMatchObject({
      functionName: 'approve',
      args: [getAddress('0x3C2064D78e4578E8F936E3db42aEF044E33FBF31'), 0n],
    })
    expect(decodeFunctionData({ abi: ABI, data: sent[1]!.data })).toMatchObject({
      functionName: 'approve',
      args: [getAddress('0x3C2064D78e4578E8F936E3db42aEF044E33FBF31'), 1_000_000n],
    })
  })

  it('skips approval when the current WBTC allowance covers the quote', async () => {
    const transferPlan = plan('hyperlane:ethereum/wbtc->aleo/wbtc', '0.001')
    const { bridgeExecutor, sent } = executor({
      token: WBTC,
      amount: 100_000n,
      nativeValue: 50_000n,
      allowance: 100_000n,
    })
    const result = await executeEvmHyperlaneTransfer(DEFAULT_BRIDGE_REGISTRY, bridgeExecutor, {
      plan: transferPlan,
      recipientBytes32: RECIPIENT,
    })
    expect(sent).toHaveLength(1)
    expect(result.approvalTxIds).toEqual([])
  })

  it('returns resumable approval state when confirmation times out', async () => {
    const transferPlan = plan('hyperlane:ethereum/wbtc->aleo/wbtc', '0.001')
    const { bridgeExecutor, sent } = executor({
      token: WBTC,
      amount: 100_000n,
      nativeValue: 50_000n,
      allowance: 0n,
      receipt: 'pending',
    })
    const result = await executeEvmHyperlaneTransfer(DEFAULT_BRIDGE_REGISTRY, bridgeExecutor, {
      plan: transferPlan,
      recipientBytes32: RECIPIENT,
      confirmationTimeoutMs: 0,
      pollingIntervalMs: 0,
    })
    expect(sent).toHaveLength(1)
    expect(result.receipt.status).toBe('SOURCE_APPROVAL_PENDING')
    expect(result.receipt.sourceTxId).toBeUndefined()
    expect(result.receipt.protocolState.approvalTxIds).toEqual(result.approvalTxIds)
  })

  it('rejects a wallet connected to the wrong chain', async () => {
    const transferPlan = plan('hyperlane:ethereum/eth->aleo/eth', '1')
    const { bridgeExecutor } = executor({ amount: 1_000_000_000_000_000_000n, nativeValue: 1_000_000_000_000_000_001n, chainId: 11155111 })
    await expect(quoteEvmHyperlaneTransfer(DEFAULT_BRIDGE_REGISTRY, bridgeExecutor, {
      plan: transferPlan,
      recipientBytes32: RECIPIENT,
    })).rejects.toThrow(/expected 1/)
  })
})
