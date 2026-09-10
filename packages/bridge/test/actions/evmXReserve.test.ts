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
import {
  execute as executeEvmXReserveTransfer,
  getAttestation as getXReserveAttestation,
} from '../../src/protocols/xreserve/evmToAleo.js'
import { execute } from '../../src/actions/execute.js'
import { waitForStatus } from '../../src/actions/waitForStatus.js'
import { createBridgeCheckpoint } from '../../src/actions/createBridgeCheckpoint.js'
import { createBridgeClient } from '../../src/clients/createBridgeClient.js'
import { prepare } from '../../src/actions/prepare.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import { createEvmClient, evmCustom, evmProvider } from '../../src/connections/evm.js'
import type { BridgeReceipt } from '../../src/types/protocol.js'

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

function transferPlan(mintMode: 'private' | 'record' = 'record') {
  return prepare(DEFAULT_BRIDGE_REGISTRY, { source: { chain: 'sepolia', asset: 'usdc' },
      destination: { chain: 'aleo-testnet', asset: 'usdcx' }, amount: '2', recipient: RECIPIENT, sender: ACCOUNT, mintMode })
}

function mockExecutor(
  confirmDeposit = { value: true },
  confirmApproval = { value: true },
) {
  const sent: Sent[] = []
  const request = async ({ method, params }: { method: string, params?: readonly unknown[] | Record<string, unknown> }) => {
      if (method === 'eth_chainId') return '0xaa36a7'
      if (method === 'eth_call') {
        const transaction = (params as readonly [{ data: Hex }])[0]
        const decoded = decodeFunctionData({ abi: ABI, data: transaction.data })
        if (decoded.functionName === 'balanceOf') return encodeFunctionResult({ abi: ABI, functionName: 'balanceOf', result: 3_000_000n })
        if (decoded.functionName === 'allowance') {
          const result = confirmApproval.value && sent.length > 0 ? 2_000_000n : 0n
          return encodeFunctionResult({ abi: ABI, functionName: 'allowance', result })
        }
      }
      if (method === 'eth_sendTransaction') {
        sent.push((params as readonly [Sent])[0])
        return sent.length === 1 ? `0x${'11'.repeat(32)}` : TX_HASH
      }
      if (method === 'eth_getTransactionReceipt') {
        const hash = (params as readonly [Hash])[0]
        if (hash !== TX_HASH) return confirmApproval.value ? { status: '0x1', logs: [] } : null
        if (!confirmDeposit.value) return null
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
  }
  const executor = createEvmClient({
    transport: evmCustom(request),
    account: evmProvider({ request }, { account: ACCOUNT }),
  }) as Required<ReturnType<typeof createEvmClient>>
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

  it('checkpoints at broadcast and resumes confirmation without resubmitting', async () => {
    const confirmDeposit = { value: false }
    const { executor, sent } = mockExecutor(confirmDeposit)
    const checkpoints: BridgeReceipt[] = []
    const pending = await executeEvmXReserveTransfer(DEFAULT_BRIDGE_REGISTRY, executor, {
      plan: transferPlan(),
      confirmationTimeoutMs: 0,
      onSubmitted(receipt) { checkpoints.push(receipt) },
    })

    expect(checkpoints.map((receipt) => receipt.status)).toEqual(['SOURCE_APPROVAL_PENDING', 'SOURCE_CONFIRMING'])
    expect(pending.receipt).toEqual(checkpoints[1])
    expect(sent).toHaveLength(2)

    confirmDeposit.value = true
    const resumed = await executeEvmXReserveTransfer(DEFAULT_BRIDGE_REGISTRY, executor, {
      plan: transferPlan(),
      resume: pending.receipt,
    })
    expect(resumed.receipt.status).toBe('ATTESTATION_PENDING')
    expect(sent).toHaveLength(2)
  })

  it('emits compact checkpoints from the protocol-neutral execute action', async () => {
    const { executor } = mockExecutor()
    const transfer = transferPlan()
    const checkpoints: unknown[] = []

    await execute(DEFAULT_BRIDGE_REGISTRY, { sepolia: executor }, {
      plan: transfer,
      onCheckpoint(checkpoint) { checkpoints.push(checkpoint) },
    })

    expect(checkpoints).toHaveLength(2)
    expect(checkpoints).toMatchObject([
      { source: { approvalTransactionIds: [`0x${'11'.repeat(32)}`] } },
      { source: { approvalTransactionIds: [`0x${'11'.repeat(32)}`], transactionId: TX_HASH } },
    ])
  })

  it('continues source confirmation through the read-only status action', async () => {
    const confirmDeposit = { value: false }
    const { executor, sent } = mockExecutor(confirmDeposit)
    const transfer = transferPlan()
    const submitted = await executeEvmXReserveTransfer(DEFAULT_BRIDGE_REGISTRY, executor, {
      plan: transfer,
      confirmationTimeoutMs: 0,
    })
    expect(submitted.receipt.status).toBe('SOURCE_CONFIRMING')

    confirmDeposit.value = true
    const receipt = await waitForStatus(
      DEFAULT_BRIDGE_REGISTRY,
      { sepolia: executor },
      async () => ({ ok: false, status: 404, json: async () => ({}) }),
      {
        plan: transfer,
        receipt: submitted.receipt,
        until: ['ATTESTATION_PENDING'],
        pollingIntervalMs: 0,
        timeoutMs: 1_000,
      },
    )

    expect(receipt.status).toBe('ATTESTATION_PENDING')
    expect(sent).toHaveLength(2)
  })

  it('recovers a confirmed source deposit from a compact checkpoint without resubmitting', async () => {
    const confirmDeposit = { value: false }
    const { executor, sent } = mockExecutor(confirmDeposit)
    const transfer = transferPlan()
    const submitted = await executeEvmXReserveTransfer(DEFAULT_BRIDGE_REGISTRY, executor, {
      plan: transfer,
      confirmationTimeoutMs: 0,
    })
    const checkpoint = createBridgeCheckpoint(transfer, submitted.receipt)

    confirmDeposit.value = true
    const bridge = createBridgeClient({
      environment: 'testnet',
      clients: { sepolia: { family: 'evm', publicClient: executor.publicClient } },
      fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response,
    })
    const progress = await bridge.recover({ checkpoint })

    expect(progress.next).toBe('wait')
    expect(progress.receipt.status).toBe('ATTESTATION_PENDING')
    expect(progress.receipt.sourceTxId).toBe(TX_HASH)
    expect(sent).toHaveLength(2)
  })

  it('checkpoints the connected source account when the plan omits sender', async () => {
    const confirmApproval = { value: false }
    const { executor } = mockExecutor({ value: true }, confirmApproval)
    const { sender: _sender, ...transfer } = transferPlan()
    let checkpoint: ReturnType<typeof createBridgeCheckpoint> | undefined

    await execute(DEFAULT_BRIDGE_REGISTRY, { sepolia: executor }, {
      plan: transfer,
      confirmationTimeoutMs: 0,
      onCheckpoint(value) { checkpoint = value },
    })

    expect(checkpoint?.intent.sender).toBe(ACCOUNT)
  })

  it('resumes an approval-only recovery without asking the caller to execute twice', async () => {
    const confirmApproval = { value: false }
    const { executor, sent } = mockExecutor({ value: true }, confirmApproval)
    const transfer = transferPlan()
    const submitted = await execute(DEFAULT_BRIDGE_REGISTRY, { sepolia: executor }, {
      plan: transfer,
      confirmationTimeoutMs: 0,
    })
    expect(submitted.receipt.status).toBe('SOURCE_APPROVAL_PENDING')
    const checkpoint = createBridgeCheckpoint(transfer, submitted.receipt)

    confirmApproval.value = true
    const bridge = createBridgeClient({
      environment: 'testnet',
      clients: { sepolia: executor },
      fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response,
    })
    const progress = await bridge.recover({ checkpoint })
    expect(progress.next).toBe('resume')
    if (progress.next !== 'resume') throw new Error(`Expected resume, received ${progress.next}`)

    const resumed = await bridge.resume({ progress })

    expect(resumed.kind).toBe('evm-xreserve')
    expect(resumed.receipt.status).toBe('ATTESTATION_PENDING')
    expect(sent).toHaveLength(2)
    expect(decodeFunctionData({ abi: ABI, data: sent[1]!.data }).functionName).toBe('depositToRemote')
  })

  it('requires the original private nonce when resuming a checkpointed approval', async () => {
    const confirmApproval = { value: false }
    const { executor } = mockExecutor({ value: true }, confirmApproval)
    const transfer = transferPlan('private')
    let checkpoint: ReturnType<typeof createBridgeCheckpoint> | undefined
    await execute(DEFAULT_BRIDGE_REGISTRY, { sepolia: executor }, {
      plan: transfer,
      privateMintSecretNonce: '7scalar',
      confirmationTimeoutMs: 0,
      onCheckpoint(value) { checkpoint = value },
    })
    expect(checkpoint?.source?.hookData).toMatch(/^0x[0-9a-f]{130}$/)
    expect(JSON.stringify(checkpoint)).not.toContain('7scalar')

    confirmApproval.value = true
    const bridge = createBridgeClient({ environment: 'testnet', clients: { sepolia: executor } })
    const progress = await bridge.recover({ checkpoint: checkpoint! })
    if (progress.next !== 'resume') throw new Error(`Expected resume, received ${progress.next}`)

    await expect(bridge.resume({ progress })).rejects.toThrow(/secret nonce does not match/)
    await expect(bridge.resume({ progress, privateMintSecretNonce: '7scalar' })).resolves.toMatchObject({
      kind: 'evm-xreserve',
      receipt: { status: 'ATTESTATION_PENDING' },
    })
  })

  it('maps an absent Circle attestation to pending', async () => {
    const result = await getXReserveAttestation(DEFAULT_BRIDGE_REGISTRY, async () => ({ ok: false, status: 404, json: async () => ({}) }), {
      routeId: transferPlan().route.id,
      messageHash: TX_HASH,
    })
    expect(result).toEqual({ status: 'pending', messageHash: TX_HASH })
  })
})
