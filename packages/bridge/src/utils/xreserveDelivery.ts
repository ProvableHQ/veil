import { readContract } from '@provablehq/veil-core'
import { isHash } from 'viem'
import type { AleoClient } from '../connections/aleo.js'
import { BridgeError } from '../errors/bridgeErrors.js'
import { xReserveHexToAleoBytes } from './xreserve.js'

/**
 * Selects the destination xReserve program and deposit to verify.
 *
 * @property bridgeProgram Destination Aleo bridge program that mints the asset.
 * @property nonce Canonical 32-byte Circle deposit nonce emitted on the source chain.
 */
export type ReadXReserveDeliveryParameters = {
  bridgeProgram: string
  nonce: string
}

/**
 * Checks whether an inbound xReserve deposit has already minted on Aleo.
 *
 * The Aleo bridge program records every completed public, record, and private
 * mint under the deposit nonce. Call this before offering or retrying a mint so
 * a refreshed application does not ask the recipient to complete settled funds.
 *
 * @param client Destination Aleo network access used to read the bridge program.
 * @param params Aleo bridge program and Circle deposit nonce emitted on Ethereum.
 * @returns Whether Aleo has finalized a mint for this deposit.
 * @throws BridgeError When the bridge program or nonce is malformed.
 * @example const delivered = await readXReserveDelivery(client, { bridgeProgram: 'usdcx_bridge_v2.aleo', nonce })
 */
export async function readXReserveDelivery(
  client: AleoClient,
  params: ReadXReserveDeliveryParameters,
): Promise<boolean> {
  if (!params.bridgeProgram.endsWith('.aleo')) {
    throw new BridgeError(`Invalid Aleo xReserve bridge program: ${params.bridgeProgram}`)
  }
  if (!isHash(params.nonce)) throw new BridgeError('xReserve delivery requires a 32-byte deposit nonce')

  const value = await readContract(client.publicClient, {
    programId: params.bridgeProgram,
    mapping: 'nullifier',
    key: xReserveHexToAleoBytes(params.nonce, 32),
  })
  if (value === null) return false
  if (typeof value !== 'string') throw new BridgeError('Aleo xReserve bridge returned an invalid nullifier value')
  return value.trim() === 'true'
}
