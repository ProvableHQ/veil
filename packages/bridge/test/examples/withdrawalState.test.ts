import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pad, encodeEventTopics, encodeAbiParameters, zeroAddress } from 'viem'
import { GATEWAY_MINTER, WITHDRAWAL_EVENTS } from '../../examples/withdrawal-delivery.js'
import type { BridgeCheckpoint } from '@provablehq/aleo-bridge-sdk'
import { openWithdrawalState } from '../../examples/withdrawal-state.js'
const rpc = vi.hoisted(() => ({ getChainId: vi.fn(), getBlockNumber: vi.fn(), readContract: vi.fn(), getLogs: vi.fn(), getTransactionReceipt: vi.fn() }))
vi.mock('viem', async original => ({ ...await original<typeof import('viem')>(), createPublicClient: () => rpc }))
const expected = { reserve: '0x0000000000000000000000000000000000000001' as const, token: '0x0000000000000000000000000000000000000002' as const, recipient: '0x0000000000000000000000000000000000000003' as const, remoteDomain: 10002, remoteToken: pad('0x12'), minimum: 1n, maximum: 2000001n }
let directory: string
let path: string
beforeEach(() => {
  vi.clearAllMocks()
  rpc.getChainId.mockResolvedValue(1)
  rpc.getBlockNumber.mockResolvedValue(100n)
  rpc.readContract.mockResolvedValue(0n)
  directory = mkdtempSync(join(tmpdir(), 'withdrawal-test-'))
  path = join(directory, 'state.json')
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))
describe('durable withdrawal observation', () => {
  it('refuses an incorrect chain before creating state', async () => {
    rpc.getChainId.mockResolvedValue(26)
    await expect(openWithdrawalState(path, 'intent', 'https://example.invalid', expected)).rejects.toThrow('Ethereum mainnet')
  })
  it('holds an exclusive lock and releases it on configuration errors', async () => {
    const first = await openWithdrawalState(path, 'intent', 'https://example.invalid', expected)
    first.begin()
    await expect(openWithdrawalState(path, 'intent', 'https://example.invalid', expected)).rejects.toThrow('EEXIST')
    first.release()
    await expect(openWithdrawalState(path, 'different', 'https://example.invalid', expected)).rejects.toThrow('differs')
    await expect(openWithdrawalState(path, 'intent', 'https://example.invalid', expected)).rejects.toThrow('Submission outcome unknown')
  })
  it('preserves the checkpoint and original observation window across timeout and restart', async () => {
    const first = await openWithdrawalState(path, 'intent', 'https://example.invalid', expected)
    const checkpoint = { version: 1, source: { transactionId: 'existing-burn' } } as BridgeCheckpoint
    first.begin()
    first.persist(checkpoint)
    await expect(first.wait(0)).rejects.toThrow('Keep the state file')
    first.release()
    rpc.getBlockNumber.mockResolvedValue(200n)
    const resumed = await openWithdrawalState(path, 'intent', 'https://example.invalid', expected)
    expect(resumed.checkpoint).toEqual(checkpoint)
    expect(JSON.parse(readFileSync(path, 'utf8')).startBlock).toBe('100')
    resumed.release()
  })
})

function deliveredReceipt() {
  return { status: 'success', blockNumber: 100n, logs: [
    { address: GATEWAY_MINTER, topics: encodeEventTopics({ abi: WITHDRAWAL_EVENTS, eventName: 'AttestationUsed', args: { token: expected.token, recipient: expected.recipient, transferSpecHash: pad('0x03') } }),
      data: encodeAbiParameters([{ type: 'uint32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }], [26, pad('0x01'), pad('0x01'), 500000n]) },
    { address: expected.token, topics: encodeEventTopics({ abi: WITHDRAWAL_EVENTS, eventName: 'Transfer', args: { from: zeroAddress, to: expected.recipient } }), data: encodeAbiParameters([{ type: 'uint256' }], [500000n]) },
  ] }
}
it('persists verified delivery and does not rescan it on restart', async () => {
  const tracker = await openWithdrawalState(path, 'intent', 'https://example.invalid', expected)
  const hash = pad('0x42')
  rpc.getBlockNumber.mockResolvedValue(101n)
  rpc.getLogs.mockResolvedValue([{ transactionHash: hash }])
  rpc.getTransactionReceipt.mockResolvedValue(deliveredReceipt())
  rpc.readContract.mockResolvedValue(500000n)
  await expect(tracker.wait()).resolves.toEqual({ hash, amount: '500000' })
  tracker.release()
  rpc.getLogs.mockClear()
  const resumed = await openWithdrawalState(path, 'intent', 'https://example.invalid', expected)
  await expect(resumed.wait()).resolves.toEqual({ hash, amount: '500000' })
  expect(rpc.getLogs).not.toHaveBeenCalled()
  resumed.release()
})
it('rejects balance activity inconsistent with the matching receipt', async () => {
  const tracker = await openWithdrawalState(path, 'intent', 'https://example.invalid', expected)
  rpc.getBlockNumber.mockResolvedValue(101n)
  rpc.getLogs.mockResolvedValue([{ transactionHash: pad('0x42') }])
  rpc.getTransactionReceipt.mockResolvedValue(deliveredReceipt())
  rpc.readContract.mockResolvedValue(600000n)
  await expect(tracker.wait()).rejects.toThrow('Destination balance does not match')
  tracker.release()
})
