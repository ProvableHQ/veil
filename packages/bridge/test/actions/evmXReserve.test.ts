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
import { describe, expect, it, vi } from 'vitest'
import {
  execute as executeEvmXReserveTransfer,
  getAttestation as getXReserveAttestation,
} from '../../src/protocols/xreserve/evmToAleo.js'
import { execute } from '../../src/actions/execute.js'
import { quote as quoteBridge } from '../../src/actions/quote.js'
import { complete } from '../../src/actions/complete.js'
import { wait } from '../../src/actions/wait.js'
import { createBridgeCheckpoint } from '../../src/actions/createBridgeCheckpoint.js'
import { createBridgeClient } from '../../src/clients/createBridgeClient.js'
import { bridgeActions } from '../../src/clients/decorators/bridge.js'
import { prepare } from '../../src/actions/prepare.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import { createEvmClient, evmCustom, evmProvider } from '../../src/connections/evm.js'
import { createAleoClient } from '../../src/connections/aleo.js'
import type { BridgeReceipt } from '../../src/types/protocol.js'
import { aleoAddressToBytes32, aleoProgramAddress, buildXReserveHookData } from '../../src/utils/xreserve.js'
import { memoryXReservePrivateMintIdentityStore } from '../../src/utils/xreservePrivateMintStore.js'

const ACCOUNT = getAddress('0x0000000000000000000000000000000000000001')
const TOKEN = getAddress('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238')
const XRESERVE = getAddress('0x008888878f94C0d87defdf0B07f46B93C1934442')
const RECIPIENT = 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n'
const TX_HASH = `0x${'22'.repeat(32)}` as Hash
const RECOVERED_TX_HASH = `0x${'44'.repeat(32)}` as Hash
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
  allowanceOverride: { value?: bigint } = {},
) {
  const sent: Sent[] = []
  const request = async ({ method, params }: { method: string, params?: readonly unknown[] | Record<string, unknown> }) => {
      if (method === 'eth_chainId') return '0xaa36a7'
      if (method === 'eth_call') {
        const transaction = (params as readonly [{ data: Hex }])[0]
        // The route pause guard reads xReserve `paused()`; report unpaused.
        if (transaction.data === '0x5c975abb') return `0x${'0'.repeat(64)}`
        const decoded = decodeFunctionData({ abi: ABI, data: transaction.data })
        if (decoded.functionName === 'balanceOf') return encodeFunctionResult({ abi: ABI, functionName: 'balanceOf', result: 3_000_000n })
        if (decoded.functionName === 'allowance') {
          const result = allowanceOverride.value
            ?? (confirmApproval.value && sent.length > 0 ? 2_000_000n : 0n)
          return encodeFunctionResult({ abi: ABI, functionName: 'allowance', result })
        }
      }
      if (method === 'eth_sendTransaction') {
        sent.push((params as readonly [Sent])[0])
        return sent.length === 1 ? `0x${'11'.repeat(32)}` : TX_HASH
      }
      if (method === 'eth_getTransactionReceipt') {
        const hash = (params as readonly [Hash])[0]
        if (hash !== TX_HASH) return confirmApproval.value ? {
          status: '0x1',
          transactionHash: hash,
          blockNumber: '0x64',
          logs: [],
        } : null
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
      if (method === 'eth_getLogs') return []
      throw new Error(`Unexpected RPC method ${method}`)
  }
  const executor = createEvmClient({
    transport: evmCustom(request),
    account: evmProvider({ request }, { account: ACCOUNT }),
  }) as Required<ReturnType<typeof createEvmClient>>
  return { executor, sent }
}

describe('Ethereum xReserve actions', () => {
  it('rejects standalone automatic derivation without a shared store before submitting funds', async () => {
    const { executor, sent } = mockExecutor()
    const clients = {
      sepolia: executor,
      'aleo-testnet': createAleoClient({
        publicClient: {} as never,
        account: {
          executeTransaction: vi.fn(),
          account: { type: 'local', address: RECIPIENT, viewKey: 'AViewKey1sqm952gJj1tmAWySYDQvSv2NmfnyEMvU6a9ZBCuyG7PN' },
        } as never,
      }),
    }
    await expect(quoteBridge(DEFAULT_BRIDGE_REGISTRY, clients, {
      source: { chain: 'sepolia', asset: 'usdc' },
      destination: { chain: 'aleo-testnet', asset: 'usdcx' },
      amount: '2', recipient: RECIPIENT, sender: ACCOUNT, mintMode: 'private',
    })).rejects.toThrow(/require circle\.privateMintIdentities/)
    await expect(execute(DEFAULT_BRIDGE_REGISTRY, clients, { plan: transferPlan('private') }))
      .rejects.toThrow(/require circle\.privateMintIdentities/)
    expect(sent).toHaveLength(0)
  })

  it('completes a standalone local private mint using the same explicitly supplied store', async () => {
    const { executor, sent } = mockExecutor()
    const privateMintIdentities = memoryXReservePrivateMintIdentityStore()
    const circle = { privateMintIdentities }
    const executeTransaction = vi.fn(async () => 'at1standalonemint')
    const clients = {
      sepolia: executor,
      'aleo-testnet': createAleoClient({
        publicClient: {} as never,
        account: {
          executeTransaction,
          account: { type: 'local', address: RECIPIENT, viewKey: 'AViewKey1sqm952gJj1tmAWySYDQvSv2NmfnyEMvU6a9ZBCuyG7PN' },
        } as never,
      }),
    }
    const quote = await quoteBridge(DEFAULT_BRIDGE_REGISTRY, clients, {
      source: { chain: 'sepolia', asset: 'usdc' },
      destination: { chain: 'aleo-testnet', asset: 'usdcx' },
      amount: '2', recipient: RECIPIENT, sender: ACCOUNT, mintMode: 'private', circle,
    })
    await expect(execute(DEFAULT_BRIDGE_REGISTRY, clients, { plan: quote.plan }))
      .rejects.toThrow(/requires circle\.privateMintIdentities/)
    await expect(execute(DEFAULT_BRIDGE_REGISTRY, clients, {
      plan: quote.plan, circle: { privateMintIdentities: memoryXReservePrivateMintIdentityStore() },
    })).rejects.toThrow(/not present in the supplied store/)
    await expect(execute(DEFAULT_BRIDGE_REGISTRY, clients, {
      plan: { ...quote.plan, circle: { privateMintAddressCommitment: quote.plan.circle!.privateMintAddressCommitment } },
      circle: { privateMintIdentities: memoryXReservePrivateMintIdentityStore() },
    })).rejects.toThrow(/not present in the supplied store/)
    const identity = (await privateMintIdentities.load())[0]!
    await expect(execute(DEFAULT_BRIDGE_REGISTRY, clients, {
      plan: quote.plan,
      circle: { privateMintIdentities: memoryXReservePrivateMintIdentityStore([{ ...identity, recipient: 'aleo1anotherrecipient' }]) },
    })).rejects.toThrow(/does not match the transfer recipient/)
    const freshClient = createBridgeClient({ environment: 'testnet', clients })
    await expect(freshClient.execute({ plan: quote.plan })).rejects.toThrow(/not present in the supplied store/)
    expect(sent).toHaveLength(0)
    const execution = await execute(DEFAULT_BRIDGE_REGISTRY, clients, { plan: quote.plan, circle })
    expect(sent).toHaveLength(2)
    const receipt: BridgeReceipt = {
      ...execution.receipt, status: 'DESTINATION_ACTION_REQUIRED',
      nextAction: { kind: 'xreserve-private-mint', chainId: 'aleo-testnet' },
      protocolState: { ...execution.receipt.protocolState, attestation: `0x${'11'.repeat(65)}` },
    }
    await expect(complete(DEFAULT_BRIDGE_REGISTRY, clients, { plan: quote.plan, receipt }))
      .rejects.toThrow(/completion requires circle\.privateMintIdentities/)
    expect(executeTransaction).not.toHaveBeenCalled()
    const completed = await complete(DEFAULT_BRIDGE_REGISTRY, clients, { plan: quote.plan, receipt, circle })
    expect(completed).toMatchObject({ kind: 'aleo-xreserve', transactionId: 'at1standalonemint' })
    const identities = await privateMintIdentities.load()
    expect(identities).toHaveLength(1)
    expect(executeTransaction).toHaveBeenCalledWith(expect.objectContaining({
      inputs: expect.arrayContaining([identities[0]!.secretNonce, RECIPIENT]),
    }))
  })

  it.each(['quoted', 'explicit'])('preserves a caller-managed %s commitment with the implicit client store', async (mode) => {
    const { executor, sent } = mockExecutor()
    const hookData = await buildXReserveHookData('private', RECIPIENT, 'testnet', '7scalar')
    const privateMintAddressCommitment = hookData.slice(4, 68)
    const executeTransaction = vi.fn(async () => 'at1externalmint')
    const bridge = createBridgeClient({
      environment: 'testnet',
      clients: {
        sepolia: executor,
        'aleo-testnet': createAleoClient({ publicClient: {} as never, account: { executeTransaction } }),
      },
    })
    let plan = transferPlan('private')
    if (mode === 'quoted') {
      const quote = await bridge.quote({
        source: { chain: 'sepolia', asset: 'usdc' },
        destination: { chain: 'aleo-testnet', asset: 'usdcx' },
        amount: '2', recipient: RECIPIENT, sender: ACCOUNT, mintMode: 'private',
        circle: { privateMintAddressCommitment },
      })
      // External provenance must survive a serialized quote, not just object identity.
      plan = JSON.parse(JSON.stringify(quote.plan))
      expect(plan.circle?.privateMintIdentitySource).toBe('external')
    }
    const execution = await bridge.execute({
      plan, ...(mode === 'explicit' ? { circle: { privateMintAddressCommitment } } : {}),
    })
    expect(sent).toHaveLength(2)
    expect(execution.receipt.protocolState.hookData).toBe(hookData)
    const completed = await bridge.complete({
      plan,
      receipt: {
        ...execution.receipt, status: 'DESTINATION_ACTION_REQUIRED',
        nextAction: { kind: 'xreserve-private-mint', chainId: 'aleo-testnet' },
        protocolState: { ...execution.receipt.protocolState, attestation: `0x${'11'.repeat(65)}` },
      },
      circle: { privateMintSecretNonce: '7scalar' },
    })
    expect(completed).toMatchObject({ transactionId: 'at1externalmint' })
  })

  it.each(['client', 'call'])('executes a caller-managed commitment absent from an explicitly supplied %s store', async (scope) => {
    const { executor, sent } = mockExecutor()
    const hookData = await buildXReserveHookData('private', RECIPIENT, 'testnet', '7scalar')
    const privateMintAddressCommitment = hookData.slice(4, 68)
    const privateMintIdentities = memoryXReservePrivateMintIdentityStore()
    const executeTransaction = vi.fn(async () => 'at1externalmint')
    const bridge = createBridgeClient({
      environment: 'testnet',
      clients: {
        sepolia: executor,
        'aleo-testnet': createAleoClient({ publicClient: {} as never, account: { executeTransaction } }),
      },
      ...(scope === 'client' ? { circle: { privateMintIdentities } } : {}),
    })
    const quote = await bridge.quote({
      source: { chain: 'sepolia', asset: 'usdc' },
      destination: { chain: 'aleo-testnet', asset: 'usdcx' },
      amount: '2', recipient: RECIPIENT, sender: ACCOUNT, mintMode: 'private',
      circle: { privateMintAddressCommitment, ...(scope === 'call' ? { privateMintIdentities } : {}) },
    })
    expect(quote.plan.circle?.privateMintIdentitySource).toBe('external')
    const execution = await bridge.execute({
      plan: quote.plan,
      ...(scope === 'call' ? { circle: { privateMintIdentities } } : {}),
    })
    expect(sent).toHaveLength(2)
    expect(execution.receipt.protocolState.hookData).toBe(hookData)
    // The store never claimed the caller's identity.
    expect(await privateMintIdentities.load()).toHaveLength(0)
    const completed = await bridge.complete({
      plan: quote.plan,
      receipt: {
        ...execution.receipt, status: 'DESTINATION_ACTION_REQUIRED',
        nextAction: { kind: 'xreserve-private-mint', chainId: 'aleo-testnet' },
        protocolState: { ...execution.receipt.protocolState, attestation: `0x${'11'.repeat(65)}` },
      },
      circle: { privateMintSecretNonce: '7scalar' },
    })
    expect(completed).toMatchObject({ transactionId: 'at1externalmint' })
  })

  it('rejects a caller-managed commitment whose stored identity names a different recipient', async () => {
    const { executor, sent } = mockExecutor()
    const privateMintAddressCommitment = '33'.repeat(32)
    const privateMintIdentities = memoryXReservePrivateMintIdentityStore([{
      counter: 0, recipient: 'aleo1anotherrecipient', secretNonce: '7scalar', addressCommitment: privateMintAddressCommitment,
    }])
    const bridge = createBridgeClient({
      environment: 'testnet', clients: { sepolia: executor }, circle: { privateMintIdentities },
    })
    await expect(bridge.execute({
      plan: transferPlan('private'),
      circle: { privateMintAddressCommitment },
    })).rejects.toThrow(/does not match the transfer recipient/)
    expect(sent).toHaveLength(0)
  })

  it('quotes and executes the AMM wallet preparation without allocating a local identity', async () => {
    const { executor, sent } = mockExecutor()
    const load = vi.fn(async () => { throw new Error('A wallet deposit must not load local identities') })
    const save = vi.fn()
    const bridge = createBridgeClient({
      environment: 'testnet',
      clients: {
        sepolia: executor,
        'aleo-testnet': createAleoClient({
          publicClient: {} as never,
          account: {
            executeTransaction: vi.fn(),
            account: { type: 'local', address: RECIPIENT, viewKey: 'AViewKey1sqm952gJj1tmAWySYDQvSv2NmfnyEMvU6a9ZBCuyG7PN' },
          } as never,
        }),
      },
      circle: { privateMintIdentities: { load, save } },
    })
    const prepared = {
      remoteRecipientBytes32: aleoAddressToBytes32(await aleoProgramAddress('shielded_usdcx_wrapper.aleo', 'testnet')),
      hookData: `0x02${'33'.repeat(32)}${'00'.repeat(32)}` as Hex,
    }
    const quote = await bridge.quote({
      source: { chain: 'sepolia', asset: 'usdc' },
      destination: { chain: 'aleo-testnet', asset: 'usdcx' },
      amount: '2', recipient: RECIPIENT, sender: ACCOUNT, mintMode: 'private',
      circle: { walletPreparedDeposit: prepared },
    })
    expect(quote).toMatchObject({ kind: 'evm-xreserve', ...prepared })
    const checkpoints: unknown[] = []
    const result = await bridge.execute({
      plan: quote.plan,
      circle: { walletPreparedDeposit: prepared },
      onCheckpoint(checkpoint) { checkpoints.push(checkpoint) },
    })
    expect(result.receipt.status).toBe('ATTESTATION_PENDING')
    expect(decodeFunctionData({ abi: ABI, data: sent[1]!.data })).toMatchObject({
      functionName: 'depositToRemote',
      args: [2_000_000n, 10_002, prepared.remoteRecipientBytes32, TOKEN, 100_000n, prepared.hookData],
    })
    expect(checkpoints).toHaveLength(2)
    expect(checkpoints[0]).toMatchObject({ source: { hookData: prepared.hookData } })
    expect(JSON.stringify(checkpoints)).not.toContain('privateMintNonceInput')
    expect(JSON.stringify(checkpoints)).not.toContain('secretNonce')
    expect(load).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('recovers and resumes a wallet-prepared approval with its original commitment', async () => {
    const confirmApproval = { value: false }
    const { executor, sent } = mockExecutor({ value: true }, confirmApproval)
    const bridge = createBridgeClient({ environment: 'testnet', clients: { sepolia: executor } })
    const plan = transferPlan('private')
    const prepared = {
      remoteRecipientBytes32: aleoAddressToBytes32(await aleoProgramAddress('shielded_usdcx_wrapper.aleo', 'testnet')),
      hookData: `0x02${'33'.repeat(32)}${'00'.repeat(32)}` as Hex,
    }
    const execution = await bridge.execute({ plan, circle: { walletPreparedDeposit: prepared }, confirmationTimeoutMs: 0 })
    expect(execution.receipt.status).toBe('SOURCE_APPROVAL_PENDING')
    confirmApproval.value = true
    const progress = await bridge.recover({ checkpoint: createBridgeCheckpoint(plan, execution.receipt) })
    expect(progress.next).toBe('resume')
    if (progress.next !== 'resume') throw new Error('Expected the approval to be resumable')
    await expect(bridge.resume({
      progress,
      circle: { walletPreparedDeposit: { ...prepared, hookData: `0x02${'44'.repeat(32)}${'00'.repeat(32)}` } },
    })).rejects.toThrow(/checkpointed approval/)
    expect(sent).toHaveLength(1)
    const result = await bridge.resume({ progress, circle: { walletPreparedDeposit: prepared } })
    expect(result.receipt.status).toBe('ATTESTATION_PENDING')
    expect(sent).toHaveLength(2)
    expect(result.receipt.protocolState.hookData).toBe(prepared.hookData)
  })

  it('rejects a changed wallet commitment while waiting for an approval to confirm', async () => {
    const confirmApproval = { value: false }
    const { executor, sent } = mockExecutor({ value: true }, confirmApproval)
    const plan = transferPlan('private')
    const prepared = {
      remoteRecipientBytes32: aleoAddressToBytes32(await aleoProgramAddress('shielded_usdcx_wrapper.aleo', 'testnet')),
      hookData: `0x02${'33'.repeat(32)}${'00'.repeat(32)}` as Hex,
    }
    const pending = await executeEvmXReserveTransfer(DEFAULT_BRIDGE_REGISTRY, executor, {
      plan, walletPreparedDeposit: prepared, confirmationTimeoutMs: 0,
    })
    confirmApproval.value = true
    await expect(executeEvmXReserveTransfer(DEFAULT_BRIDGE_REGISTRY, executor, {
      plan, resume: pending.receipt,
      walletPreparedDeposit: { ...prepared, hookData: `0x02${'44'.repeat(32)}${'00'.repeat(32)}` },
    })).rejects.toThrow(/checkpointed approval/)
    expect(sent).toHaveLength(1)
  })

  it.each(['wrapper', 'selector', 'padding', 'record', 'scalar', 'commitment', 'nonce-without-preparation'])(
    'rejects an invalid wallet deposit (%s) before any approval or deposit', async (invalid) => {
      const { executor, sent } = mockExecutor()
      const prepared = {
        remoteRecipientBytes32: aleoAddressToBytes32(await aleoProgramAddress('shielded_usdcx_wrapper.aleo', 'testnet')),
        hookData: `0x02${'33'.repeat(32)}${'00'.repeat(32)}` as Hex,
      }
      const params = {
        plan: transferPlan(invalid === 'record' ? 'record' : 'private'),
        walletPreparedDeposit: prepared,
        ...(invalid === 'scalar' ? { privateMintSecretNonce: '7scalar' } : {}),
        ...(invalid === 'commitment' ? { privateMintAddressCommitment: '33'.repeat(32) } : {}),
      }
      if (invalid === 'wrapper') prepared.remoteRecipientBytes32 = `0x${'22'.repeat(32)}`
      if (invalid === 'selector') prepared.hookData = `0x01${'33'.repeat(32)}${'00'.repeat(32)}`
      if (invalid === 'padding') prepared.hookData = `0x02${'33'.repeat(32)}${'00'.repeat(31)}01`
      await expect(executeEvmXReserveTransfer(DEFAULT_BRIDGE_REGISTRY, executor, invalid === 'nonce-without-preparation'
        ? { plan: params.plan, privateMintNonceInput: '7scalar' }
        : params)).rejects.toThrow(/wallet|nonce source/i)
      expect(sent).toHaveLength(0)
    },
  )

  it('quotes a prepared sender through read-only EVM network access', async () => {
    const { executor } = mockExecutor()
    const bridge = createBridgeClient({
      environment: 'testnet',
      clients: {
        sepolia: { family: 'evm', publicClient: executor.publicClient },
      },
    })

    await expect(bridge.quote({
      source: { chain: 'sepolia', asset: 'usdc' },
      destination: { chain: 'aleo-testnet', asset: 'usdcx' },
      amount: '2',
      recipient: RECIPIENT,
      sender: ACCOUNT,
      mintMode: 'record',
    })).resolves.toMatchObject({
      kind: 'evm-xreserve',
      balanceAtomic: 3_000_000n,
      allowanceAtomic: 0n,
      approvalRequired: true,
    })
  })

  it('reserves and encodes a local private-mint identity without Shield', async () => {
    const { executor } = mockExecutor()
    const privateMintIdentities = memoryXReservePrivateMintIdentityStore()
    const bridge = createBridgeClient({
      environment: 'testnet',
      circle: { privateMintIdentities },
      clients: {
        sepolia: { family: 'evm', publicClient: executor.publicClient },
        'aleo-testnet': createAleoClient({
          publicClient: {} as never,
          account: {
            executeTransaction: async () => 'at1unused',
            account: {
              type: 'local',
              address: RECIPIENT,
              viewKey: 'AViewKey1sqm952gJj1tmAWySYDQvSv2NmfnyEMvU6a9ZBCuyG7PN',
            },
          } as never,
        }),
      },
    })

    const quote = await bridge.quote({
      source: { chain: 'sepolia', asset: 'usdc' },
      destination: { chain: 'aleo-testnet', asset: 'usdcx' },
      amount: '2',
      recipient: RECIPIENT,
      sender: ACCOUNT,
      mintMode: 'private',
    })

    expect(quote).toMatchObject({ kind: 'evm-xreserve', privateMintAddressCommitment: expect.stringMatching(/^[0-9a-f]{64}$/) })
    const identities = await privateMintIdentities.load()
    expect(identities).toHaveLength(1)
    expect(identities[0]).toMatchObject({ counter: 0, recipient: RECIPIENT })
    expect(quote.kind === 'evm-xreserve' && quote.hookData)
      .toBe(`0x02${identities[0]!.addressCommitment}${'00'.repeat(32)}`)
  })

  it('executes the identity reserved by its quote without a forwarded commitment', async () => {
    const { executor, sent } = mockExecutor()
    const privateMintIdentities = memoryXReservePrivateMintIdentityStore()
    const bridge = createBridgeClient({
      environment: 'testnet',
      circle: { privateMintIdentities },
      clients: {
        sepolia: executor,
        'aleo-testnet': createAleoClient({
          publicClient: {} as never,
          account: {
            executeTransaction: async () => 'at1unused',
            account: { type: 'local', address: RECIPIENT, viewKey: 'AViewKey1sqm952gJj1tmAWySYDQvSv2NmfnyEMvU6a9ZBCuyG7PN' },
          } as never,
        }),
      },
    })
    const quote = await bridge.quote({
      source: { chain: 'sepolia', asset: 'usdc' },
      destination: { chain: 'aleo-testnet', asset: 'usdcx' },
      amount: '2', recipient: RECIPIENT, sender: ACCOUNT, mintMode: 'private',
    })
    if (quote.kind !== 'evm-xreserve') throw new Error(`Expected evm-xreserve, received ${quote.kind}`)
    expect(quote.plan.circle?.privateMintAddressCommitment).toBe(quote.privateMintAddressCommitment)

    const execution = await bridge.execute({ plan: quote.plan })

    expect(await privateMintIdentities.load()).toHaveLength(1)
    expect(execution.receipt.protocolState).toMatchObject({
      hookData: quote.hookData,
      privateMintAddressCommitment: quote.privateMintAddressCommitment,
    })
    expect(decodeFunctionData({ abi: ABI, data: sent[1]!.data })).toMatchObject({
      functionName: 'depositToRemote',
      args: [2_000_000n, 10_002, quote.remoteRecipientBytes32, TOKEN, 100_000n, quote.hookData],
    })
    await expect(bridge.execute({ plan: quote.plan, circle: { privateMintAddressCommitment: '33'.repeat(32) } }))
      .rejects.toThrow(/does not match the quoted plan/)
    await expect(bridge.execute({ plan: quote.plan, circle: { privateMintSecretNonce: '7scalar' } }))
      .rejects.toThrow(/reserved a local private mint identity/)
    expect(await privateMintIdentities.load()).toHaveLength(1)
  })

  it('shares one memory identity store for legacy bridgeActions callers', async () => {
    const { executor } = mockExecutor()
    const bridge = bridgeActions({
      registry: DEFAULT_BRIDGE_REGISTRY,
      clients: {
        sepolia: { family: 'evm', publicClient: executor.publicClient },
        'aleo-testnet': createAleoClient({
          publicClient: {} as never,
          account: {
            executeTransaction: async () => 'at1unused',
            account: {
              type: 'local',
              address: RECIPIENT,
              viewKey: 'AViewKey1sqm952gJj1tmAWySYDQvSv2NmfnyEMvU6a9ZBCuyG7PN',
            },
          } as never,
        }),
      },
      fetch: globalThis.fetch,
    })
    const intent = {
      source: { chain: 'sepolia', asset: 'usdc' },
      destination: { chain: 'aleo-testnet', asset: 'usdcx' },
      amount: '2',
      recipient: RECIPIENT,
      sender: ACCOUNT,
      mintMode: 'private' as const,
    }

    const first = await bridge.quote(intent)
    const second = await bridge.quote(intent)

    expect(first).toMatchObject({ kind: 'evm-xreserve', privateMintAddressCommitment: expect.any(String) })
    expect(second).toMatchObject({ kind: 'evm-xreserve', privateMintAddressCommitment: expect.any(String) })
    expect(first.kind === 'evm-xreserve' && first.privateMintAddressCommitment)
      .not.toBe(second.kind === 'evm-xreserve' && second.privateMintAddressCommitment)
  })

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
    const progress = await wait(
      DEFAULT_BRIDGE_REGISTRY,
      { sepolia: executor },
      async () => ({ ok: false, status: 404, json: async () => ({}) }),
      {
        progress: { next: 'wait', plan: transfer, receipt: submitted.receipt },
        until: ['ATTESTATION_PENDING'],
        pollingIntervalMs: 0,
        timeoutMs: 1_000,
      },
    )

    expect(progress.receipt.status).toBe('ATTESTATION_PENDING')
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

  it('finds a matching source deposit immediately before resume instead of submitting another deposit', async () => {
    const confirmApproval = { value: false }
    const { executor, sent } = mockExecutor({ value: true }, confirmApproval)
    const transfer = transferPlan()
    const submitted = await execute(DEFAULT_BRIDGE_REGISTRY, { sepolia: executor }, {
      plan: transfer,
      confirmationTimeoutMs: 0,
    })
    const checkpoint = createBridgeCheckpoint(transfer, submitted.receipt)

    confirmApproval.value = true
    const bridge = createBridgeClient({ environment: 'testnet', clients: { sepolia: executor } })
    const progress = await bridge.recover({ checkpoint })
    if (progress.next !== 'resume') throw new Error(`Expected resume, received ${progress.next}`)

    const hookData = `0x01${'00'.repeat(64)}` as Hex
    const remoteRecipient = aleoAddressToBytes32(RECIPIENT)
    const depositLog = {
      address: XRESERVE,
      blockNumber: 101n,
      transactionHash: RECOVERED_TX_HASH,
      logIndex: 3,
      topics: encodeEventTopics({
        abi: ABI,
        eventName: 'DepositedToRemote',
        args: { localToken: TOKEN, localDepositor: ACCOUNT, remoteRecipient },
      }),
      data: encodeAbiParameters(
        [{ type: 'uint256' }, { type: 'uint32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'bytes' }],
        [2_000_000n, 10_002, '0xb143ed52c774cd1d4a519d0e796f15916be5a9e1d45edcd9852dd23f68f53401', 100_000n, hookData],
      ),
    }
    const originalGetReceipt = executor.publicClient.getTransactionReceipt
    Object.assign(executor.publicClient, {
      getLogs: async () => [depositLog],
      getTransactionReceipt: async (hash: Hash) => hash === RECOVERED_TX_HASH
        ? { status: 'success', transactionHash: RECOVERED_TX_HASH, blockNumber: 101n, logs: [depositLog] }
        : originalGetReceipt(hash),
    })

    const resumed = await bridge.resume({ progress })

    expect(resumed).toMatchObject({
      kind: 'evm-xreserve',
      receipt: { status: 'ATTESTATION_PENDING', sourceTxId: RECOVERED_TX_HASH },
    })
    expect(sent).toHaveLength(1)
  })

  it('does not approve again when a recovered approval allowance was consumed', async () => {
    const confirmApproval = { value: false }
    const allowance = { value: 0n }
    const { executor, sent } = mockExecutor(
      { value: true },
      confirmApproval,
      allowance,
    )
    const transfer = transferPlan()
    const submitted = await execute(DEFAULT_BRIDGE_REGISTRY, { sepolia: executor }, {
      plan: transfer,
      confirmationTimeoutMs: 0,
    })
    const checkpoint = createBridgeCheckpoint(transfer, submitted.receipt)

    confirmApproval.value = true
    const bridge = createBridgeClient({
      environment: 'testnet',
      clients: { sepolia: executor },
    })
    const progress = await bridge.recover({ checkpoint })
    if (progress.next !== 'resume') throw new Error(`Expected resume, received ${progress.next}`)

    await expect(bridge.resume({ progress })).rejects.toThrow(/allowance is no longer available/)
    expect(sent).toHaveLength(1)
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

  it('checkpoints and resumes a locally derived private mint using only its public commitment', async () => {
    const confirmApproval = { value: false }
    const { executor } = mockExecutor({ value: true }, confirmApproval)
    const transfer = transferPlan('private')
    const commitment = '3c47112203a792e5a2d46f059016c06d83bdad32ada95d15ad66e2bc26f7fc0b'
    let checkpoint: ReturnType<typeof createBridgeCheckpoint> | undefined

    await execute(DEFAULT_BRIDGE_REGISTRY, { sepolia: executor }, {
      plan: transfer,
      circle: { privateMintAddressCommitment: commitment },
      confirmationTimeoutMs: 0,
      onCheckpoint(value) { checkpoint = value },
    })

    expect(checkpoint?.source).toMatchObject({
      hookData: `0x02${commitment}${'00'.repeat(32)}`,
      privateMintAddressCommitment: commitment,
    })
    expect(JSON.stringify(checkpoint)).not.toContain('scalar')

    confirmApproval.value = true
    const bridge = createBridgeClient({ environment: 'testnet', clients: { sepolia: executor } })
    const progress = await bridge.recover({ checkpoint: checkpoint! })
    if (progress.next !== 'resume') throw new Error(`Expected resume, received ${progress.next}`)

    await expect(bridge.resume({ progress })).resolves.toMatchObject({
      kind: 'evm-xreserve',
      receipt: {
        status: 'ATTESTATION_PENDING',
        protocolState: { privateMintAddressCommitment: commitment },
      },
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
