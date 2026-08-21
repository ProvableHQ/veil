import { isHash, isHex, type Hash, type Hex } from 'viem'
import { BridgeError } from '../errors/bridgeErrors.js'
import type {
  AleoBridgeExecutor,
  ExecuteXReservePrivateMintParameters,
  XReservePrivateMintExecution,
} from '../types/aleo.js'
import type { BridgeRegistry } from '../types/protocol.js'
import { buildXReserveHookData, calculateXReserveMessageHash, xReserveHexToAleoBytes } from '../utils/xreserve.js'

/**
 * Submits the sole user-authorized Aleo mint in the inbound bridge flows.
 *
 * Requires a private xReserve plan and a completed Circle attestation. The
 * wallet calls the wrapper's `private_mint` with the canonical 305-byte payload,
 * 65-byte signature, 32-byte hash, the plan's secret nonce, and intended recipient. Hyperlane
 * and non-private xReserve destination mints remain relayer-driven.
 *
 * @param registry Reviewed deployment snapshot used to resolve the wrapper program.
 * @param executor Connected Aleo wallet client that proves, signs, and broadcasts.
 * @param params Original plan, confirmed deposit, Circle attestation, and fee privacy choice.
 * @returns The Aleo transaction id and destination-confirming transfer receipt.
 * @throws BridgeError When the plan is not private, identifiers disagree, inputs have invalid widths, or the wallet returns no transaction id.
 *
 * @example
 * const mint = await executeXReservePrivateMint(registry, aleoWalletClient, {
 *   plan,
 *   deposit: depositExecution.receipt,
 *   attestation,
 * })
 */
export async function executeXReservePrivateMint(
  registry: BridgeRegistry,
  executor: AleoBridgeExecutor,
  params: ExecuteXReservePrivateMintParameters,
): Promise<XReservePrivateMintExecution> {
  const { plan, deposit, attestation } = params
  if (plan.protocol !== 'xreserve' || plan.route.protocol !== 'xreserve' || plan.mintMode !== 'private') {
    throw new BridgeError('private_mint requires a private xReserve transfer plan')
  }
  if (plan.registryVersion !== registry.version) throw new BridgeError(`Transfer plan uses registry ${plan.registryVersion}; expected ${registry.version}`)
  const route = registry.routes.find((entry) => entry.id === plan.route.id)
  if (!route || route.protocol !== 'xreserve' || route.availability !== 'active') throw new BridgeError(`xReserve route is not executable: ${plan.route.id}`)
  const wrapperProgram = route.metadata?.wrapperProgram
  if (typeof wrapperProgram !== 'string' || !wrapperProgram.endsWith('.aleo')) throw new BridgeError(`xReserve wrapper program is invalid: ${plan.route.id}`)
  if (deposit.protocol !== 'xreserve' || deposit.status !== 'ATTESTATION_PENDING') throw new BridgeError('Private mint requires a confirmed xReserve deposit awaiting attestation')
  if (attestation.status !== 'complete') throw new BridgeError('Private mint requires a completed Circle attestation')

  const depositPayload = deposit.protocolState.payload
  const depositHash = deposit.protocolState.messageHash
  const intendedRecipient = deposit.protocolState.intendedRecipient
  const mintMode = deposit.protocolState.mintMode
  if (typeof depositPayload !== 'string' || !isHex(depositPayload, { strict: true })) throw new BridgeError('Deposit receipt is missing the canonical xReserve payload')
  if (typeof depositHash !== 'string' || !isHash(depositHash)) throw new BridgeError('Deposit receipt is missing the Circle message hash')
  if (typeof intendedRecipient !== 'string' || intendedRecipient !== plan.recipient || mintMode !== 'private') throw new BridgeError('Deposit receipt does not match the private mint plan')
  if (attestation.payload.toLowerCase() !== depositPayload.toLowerCase() || attestation.messageHash.toLowerCase() !== depositHash.toLowerCase()) throw new BridgeError('Circle attestation does not match the confirmed deposit')
  if (calculateXReserveMessageHash(attestation.payload) !== attestation.messageHash) throw new BridgeError('Circle attestation payload has an invalid message hash')
  const secretNonce = plan.privateMintSecretNonce ?? '0scalar'
  const expectedHookData = await buildXReserveHookData('private', plan.recipient, route.environment, secretNonce)
  const attestedHookData = `0x${attestation.payload.slice(-130)}`
  if (attestedHookData.toLowerCase() !== expectedHookData.toLowerCase()) {
    throw new BridgeError('Private mint secret nonce and recipient do not match the attested hook data')
  }

  const result = await executor.executeTransaction({
    program: wrapperProgram,
    function: 'private_mint',
    inputs: [
      xReserveHexToAleoBytes(attestation.payload, 305),
      xReserveHexToAleoBytes(attestation.attestation, 65),
      xReserveHexToAleoBytes(attestation.messageHash, 32),
      secretNonce,
      plan.recipient,
    ],
    privateFee: params.privateFee ?? false,
  })
  const transactionId = typeof result === 'string' ? result : result.transactionId
  if (!transactionId) throw new BridgeError('Aleo wallet returned an empty private mint transaction id')
  return {
    transactionId,
    receipt: {
      ...deposit,
      status: 'DESTINATION_CONFIRMING',
      destinationTxId: transactionId,
      protocolState: {
        ...deposit.protocolState,
        attestation: attestation.attestation,
        destinationProgram: wrapperProgram,
        destinationFunction: 'private_mint',
        secretNonce,
      },
    },
  }
}
