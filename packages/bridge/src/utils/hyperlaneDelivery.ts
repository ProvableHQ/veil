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

/** Encodes a 32-byte Hyperlane message id as the two little-endian u128 limbs used by the Aleo Mailbox mapping key. */
function aleoDeliveryKey(messageId: `0x${string}`): string {
  const bytes = hexToBytes(messageId)
  const first = littleEndianU128(bytes.slice(0, 16))
  const second = littleEndianU128(bytes.slice(16, 32))
  return `{ id: [${first}u128, ${second}u128] }`
}

/**
 * Checks whether the destination Hyperlane Mailbox accepted a transfer message.
 *
 * The Mailbox contract or program is the authoritative delivery record, unlike
 * a third-party explorer that may lag or omit a route. The helper reads the
 * destination chain once and never requests a signature or moves funds.
 *
 * @param client Destination EVM or Aleo network access used to read the Mailbox.
 * @param params Hyperlane message identifier and the destination Mailbox contract or program.
 * @returns Whether the destination chain has recorded the message as delivered.
 * @throws BridgeError When the message identifier is invalid or the Mailbox does not belong to the destination chain family.
 * @example const delivered = await readHyperlaneDelivery(client, { messageId, mailbox: 'hyp_mailbox.aleo' })
 */
export async function readHyperlaneDelivery(
  client: AleoClient | EvmClient,
  params: ReadHyperlaneDeliveryParameters,
): Promise<boolean> {
  if (!isHash(params.messageId)) throw new BridgeError('Hyperlane delivery requires a 32-byte message id')

  if (client.family === 'aleo') {
    if (!params.mailbox.endsWith('.aleo')) throw new BridgeError(`Invalid Aleo Hyperlane mailbox program: ${params.mailbox}`)
    // Aleo stores successful deliveries by a struct containing two u128 limbs;
    // mapping presence, not a third-party API, is the acceptance signal.
    return await readContract(client.publicClient, {
      programId: params.mailbox,
      mapping: 'deliveries',
      key: aleoDeliveryKey(params.messageId),
    }) !== null
  }

  if (!isAddress(params.mailbox)) throw new BridgeError(`Invalid EVM Hyperlane mailbox address: ${params.mailbox}`)
  const mailbox = getAddress(params.mailbox)
  // EVM Mailboxes expose the same canonical state through delivered(bytes32).
  const data = encodeFunctionData({
    abi: EVM_MAILBOX_ABI,
    functionName: 'delivered',
    args: [params.messageId],
  })
  const result = await client.publicClient.call({ to: mailbox, data })
  return decodeFunctionResult({ abi: EVM_MAILBOX_ABI, functionName: 'delivered', data: result })
}
