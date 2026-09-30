import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, encodeEventTopics, pad, type Hex } from 'viem'
import { withdrawalAmount, WITHDRAWAL_EVENTS } from '../../examples/withdrawal-delivery.js'
const reserve = '0x8888888199b2Df864bf678259607d6D5EBb4e3Ce' as const
const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const
const recipient = '0x0000000000000000000000000000000000000001' as const
const remoteToken = pad('0x12', { size: 32 })
const expected = { reserve, token, recipient, remoteToken, remoteDomain: 10002, minimum: 1n, maximum: 2000001n }
function logs(amount = 996501n) {
  return [
    { address: reserve, topics: encodeEventTopics({ abi: WITHDRAWAL_EVENTS, eventName: 'Withdrawn', args: { localToken: token, remoteDepositor: pad('0x01', { size: 32 }), localRecipient: recipient } }) as Hex[],
      data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint32' }, { type: 'bytes32' }, { type: 'bytes32' }], [amount, 10002, remoteToken, pad('0x02', { size: 32 })]) },
    { address: token, topics: encodeEventTopics({ abi: WITHDRAWAL_EVENTS, eventName: 'Transfer', args: { from: reserve, to: recipient } }) as Hex[], data: encodeAbiParameters([{ type: 'uint256' }], [amount]) },
  ]
}
describe('withdrawal receipt verification', () => {
  it('requires matching reserve withdrawal and actual USDC transfer', () => expect(withdrawalAmount(logs(), expected)).toBe(996501n))
  it('rejects a transfer with no matching withdrawal', () => expect(withdrawalAmount(logs().slice(1), expected)).toBeUndefined())
  it('rejects a withdrawal without token delivery', () => expect(withdrawalAmount(logs().slice(0, 1), expected)).toBeUndefined())
  it.each([0n, 2000002n])('rejects amounts outside the authorized bounds: %s', amount => expect(withdrawalAmount(logs(amount), expected)).toBeUndefined())
  it('rejects a different recipient', () => expect(withdrawalAmount(logs(), { ...expected, recipient: reserve })).toBeUndefined())
  it('rejects a different remote domain', () => expect(withdrawalAmount(logs(), { ...expected, remoteDomain: 26 })).toBeUndefined())
  it('rejects a different remote token', () => expect(withdrawalAmount(logs(), { ...expected, remoteToken: pad('0x34', { size: 32 }) })).toBeUndefined())
  it('rejects duplicate withdrawal evidence', () => expect(withdrawalAmount([...logs(), logs()[0]!], expected)).toBeUndefined())
})

import { GATEWAY_MINTER } from '../../examples/withdrawal-delivery.js'
import { zeroAddress } from 'viem'
function gatewayLogs() {
  return [
    { address: GATEWAY_MINTER, topics: encodeEventTopics({ abi: WITHDRAWAL_EVENTS, eventName: 'AttestationUsed', args: { token, recipient, transferSpecHash: pad('0x02', { size: 32 }) } }) as Hex[],
      data: encodeAbiParameters([{ type: 'uint32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }], [26, pad('0x01', { size: 32 }), pad('0x01', { size: 32 }), 996501n]) },
    { address: token, topics: encodeEventTopics({ abi: WITHDRAWAL_EVENTS, eventName: 'Transfer', args: { from: zeroAddress, to: recipient } }) as Hex[], data: encodeAbiParameters([{ type: 'uint256' }], [996501n]) },
  ]
}
describe('Gateway settlement', () => {
  it('accepts a Gateway attestation plus the matching canonical USDC mint', () => expect(withdrawalAmount(gatewayLogs(), expected)).toBe(996501n))
  it('rejects an impostor minter', () => expect(withdrawalAmount([{ ...gatewayLogs()[0]!, address: reserve }, gatewayLogs()[1]!], expected)).toBeUndefined())
  it('rejects a different token', () => expect(withdrawalAmount(gatewayLogs(), { ...expected, token: reserve })).toBeUndefined())
  it('rejects a different recipient', () => expect(withdrawalAmount(gatewayLogs(), { ...expected, recipient: reserve })).toBeUndefined())
  it('rejects insufficient delivery', () => expect(withdrawalAmount(gatewayLogs(), { ...expected, minimum: 1000000n })).toBeUndefined())
  it('rejects mismatched transfer value', () => expect(withdrawalAmount([gatewayLogs()[0]!, { ...gatewayLogs()[1]!, data: encodeAbiParameters([{ type: 'uint256' }], [1n]) }], expected)).toBeUndefined())
  it('rejects duplicate attestations', () => expect(withdrawalAmount([...gatewayLogs(), gatewayLogs()[0]!], expected)).toBeUndefined())
})
