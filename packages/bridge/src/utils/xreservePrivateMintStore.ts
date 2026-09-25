import { BridgeError } from '../errors/bridgeErrors.js'
import type { BridgeEnvironment } from '../types/protocol.js'
import {
  deriveXReservePrivateMintAddressCommitment,
  deriveXReservePrivateMintSecretNonce,
} from './xreserve.js'

/**
 * A locally derived identity reserved for one private USDCx deposit.
 *
 * @property counter Monotonic u32 input used by the scalar derivation.
 * @property recipient Aleo account bound into the BHP256 commitment.
 * @property secretNonce Private scalar supplied to the wrapper mint.
 * @property addressCommitment Public 32-byte commitment encoded as lowercase hex.
 */
export type XReservePrivateMintIdentity = {
  counter: number
  recipient: string
  secretNonce: string
  addressCommitment: string
}

/**
 * Persistence used to prevent private-mint counters from being issued twice.
 *
 * @property load Returns all identities reserved for the configured account and deployment.
 * @property save Replaces the persisted identities after a reservation.
 */
export interface XReservePrivateMintIdentityStore {
  load: () => Promise<XReservePrivateMintIdentity[]>
  save: (identities: XReservePrivateMintIdentity[]) => Promise<void>
}

/**
 * Builds a process-local private-mint identity store.
 *
 * The store serializes concurrent reservations but does not survive a restart.
 * Long-running Node applications should use the file-backed store exported by
 * `@provablehq/aleo-bridge-sdk/node`.
 *
 * @param initial Existing identities used to seed the store.
 * @returns An in-memory identity store.
 */
export function memoryXReservePrivateMintIdentityStore(
  initial: XReservePrivateMintIdentity[] = [],
): XReservePrivateMintIdentityStore {
  let identities = [...initial]
  return {
    load: async () => [...identities],
    save: async (next) => {
      identities = [...next]
    },
  }
}

const queues = new WeakMap<XReservePrivateMintIdentityStore, Promise<unknown>>()

function withStoreLock<T>(
  store: XReservePrivateMintIdentityStore,
  action: () => Promise<T>,
): Promise<T> {
  const next = (queues.get(store) ?? Promise.resolve()).then(action, action)
  queues.set(store, next.catch(() => {}))
  return next
}

/**
 * Reserves the next local identity for a private USDCx deposit.
 *
 * The counter advances monotonically from the highest persisted value. The
 * reservation is saved before it is returned, closing the in-process race
 * between concurrent deposits. No Shield connection or wallet-derived input is
 * involved.
 *
 * @param params Local view-key scalar, recipient, wrapper deployment, and identity store.
 * @returns The persisted counter, scalar, and public address commitment.
 * @throws BridgeError When stored identities are malformed or the counter space is exhausted.
 */
export async function reserveXReservePrivateMintIdentity(params: {
  store: XReservePrivateMintIdentityStore
  viewKeyScalar: string
  recipient: string
  environment: BridgeEnvironment
  program?: string | undefined
}): Promise<XReservePrivateMintIdentity> {
  return withStoreLock(params.store, async () => {
    const identities = await params.store.load()
    for (const identity of identities) validateIdentity(identity)
    const counter = identities.length === 0
      ? 0
      : Math.max(...identities.map((identity) => identity.counter)) + 1
    if (counter > 0xffffffff) throw new BridgeError('Private mint identity counter space is exhausted')
    const secretNonce = await deriveXReservePrivateMintSecretNonce(
      params.viewKeyScalar,
      counter,
      params.environment,
      params.program,
    )
    const addressCommitment = await deriveXReservePrivateMintAddressCommitment(
      params.recipient,
      secretNonce,
      params.environment,
    )
    const identity = { counter, recipient: params.recipient, secretNonce, addressCommitment }
    await params.store.save([...identities, identity])
    return identity
  })
}

/**
 * Finds a stored private-mint identity by its public address commitment.
 *
 * @param store Identity store configured for the bridge client.
 * @param addressCommitment Canonical public commitment from xReserve hook data.
 * @returns The matching local identity, or `undefined` when this store did not issue it.
 * @throws BridgeError When the store contains malformed records.
 */
export async function findXReservePrivateMintIdentity(
  store: XReservePrivateMintIdentityStore,
  addressCommitment: string,
): Promise<XReservePrivateMintIdentity | undefined> {
  const identities = await store.load()
  for (const identity of identities) validateIdentity(identity)
  return identities.find((identity) => identity.addressCommitment === addressCommitment)
}

function validateIdentity(identity: XReservePrivateMintIdentity): void {
  if (!Number.isSafeInteger(identity.counter) || identity.counter < 0 || identity.counter > 0xffffffff
    || typeof identity.recipient !== 'string' || !identity.recipient.startsWith('aleo1')
    || typeof identity.secretNonce !== 'string' || !identity.secretNonce.endsWith('scalar')
    || !/^[0-9a-f]{64}$/.test(identity.addressCommitment)) {
    throw new BridgeError('Private mint identity store contains an invalid record')
  }
}
