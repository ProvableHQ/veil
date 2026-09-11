import { readContract } from '@provablehq/veil-core'
import { decodeFunctionResult, encodeFunctionData, getAddress, hexToBytes, isAddress, isHash, parseAbi } from 'viem'
import type { AleoClient } from '../connections/aleo.js'
import type { EvmClient } from '../connections/evm.js'
import { BridgeError } from '../errors/bridgeErrors.js'

const EVM_MAILBOX_ABI = parseAbi(['function delivered(bytes32 id) view returns (bool)'])

/**
 * Selects the destination mailbox and dispatched Hyperlane message to verify.
 *
 * @property mailbox Destination Mailbox contract address or Aleo program id.
 * @property messageId Canonical 32-byte Hyperlane message identifier.
 */
export type ReadHyperlaneDeliveryParameters = {
  mailbox: string
  messageId: string
}

function littleEndianU128(bytes: Uint8Array): bigint {
  let value = 0n
  for (let index = 0; index < bytes.length; index++) {
    value |= BigInt(bytes[index]!) << BigInt(index * 8)
  }
  return value
}

function aleoDeliveryKey(messageId: `0x${string}`): string {
  const bytes = hexToBytes(messageId)
  const first = littleEndianU128(bytes.slice(0, 16))
  const second = littleEndianU128(bytes.slice(16, 32))
  return `{ id: [${first}u128, ${second}u128] }`
}

/**
 * Reads canonical Hyperlane delivery state from a destination mailbox.
 *
 * Supports EVM Mailbox `delivered(bytes32)` calls and Aleo
 * `hyp_mailbox.aleo/deliveries` mapping reads. Hits the destination chain but
 * never signs or submits a transaction.
 *
 * @param client Destination EVM or Aleo client used for the mailbox read.
 * @param params Message identifier and destination mailbox deployment.
 * @returns Whether the destination mailbox has processed the message.
 * @throws BridgeError When the message id or mailbox does not match the destination family.
 * @example const delivered = await readHyperlaneDelivery(client, { messageId, mailbox: 'hyp_mailbox.aleo' })
 */
export async function readHyperlaneDelivery(
  client: AleoClient | EvmClient,
  params: ReadHyperlaneDeliveryParameters,
): Promise<boolean> {
  if (!isHash(params.messageId)) throw new BridgeError('Hyperlane delivery requires a 32-byte message id')

  if (client.family === 'aleo') {
    if (!params.mailbox.endsWith('.aleo')) throw new BridgeError(`Invalid Aleo Hyperlane mailbox program: ${params.mailbox}`)
    return await readContract(client.publicClient, {
      programId: params.mailbox,
      mapping: 'deliveries',
      key: aleoDeliveryKey(params.messageId),
    }) !== null
  }

  if (!isAddress(params.mailbox)) throw new BridgeError(`Invalid EVM Hyperlane mailbox address: ${params.mailbox}`)
  const mailbox = getAddress(params.mailbox)
  const data = encodeFunctionData({
    abi: EVM_MAILBOX_ABI,
    functionName: 'delivered',
    args: [params.messageId],
  })
  const result = await client.publicClient.call({ to: mailbox, data })
  return decodeFunctionResult({ abi: EVM_MAILBOX_ABI, functionName: 'delivered', data: result })
}
