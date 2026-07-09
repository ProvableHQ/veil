import type { AnyAccount } from '../types/account.js'
import type { ProvingConfig } from '../types/proving.js'
import type { RecordProvider } from '../types/records.js'
import type { Transport } from '../types/transport.js'
import { uid as createUid } from '../utils/uid.js'

/**
 * Configuration for {@link createClient}.
 *
 * @property account Optional account that signs and submits transactions. Public,
 *   read-only clients omit it; wallet clients supply one.
 * @property key Optional identifier for the client's type. Defaults to `"base"`.
 * @property name Optional human-readable name for the client. Defaults to `"Client"`.
 * @property proving Optional proving configuration selecting where zero-knowledge
 *   proofs are generated (wallet, local, or devnode). Omit for read-only clients.
 * @property transport Transport that carries requests to the network.
 */
export type ClientConfig = {
  account?: AnyAccount | undefined
  key?: string | undefined
  name?: string | undefined
  proving?: ProvingConfig | undefined
  transport: Transport
}

/**
 * Base client returned by {@link createClient}.
 *
 * Holds the transport, account, and proving configuration shared by every
 * client, plus `extend` for layering actions on top. The public, wallet, and
 * test clients are this base extended with their respective action decorators.
 *
 * @property account The account that signs transactions, or `undefined` for a
 *   read-only client.
 * @property key Identifier for the client's type (for example `"public"`).
 * @property name Human-readable name for the client.
 * @property proving Proving configuration, or `undefined` when the client cannot
 *   produce transactions.
 * @property request Transport request function, called to reach the network.
 * @property transport The transport backing `request`.
 * @property uid Unique identifier for this client instance.
 * @property extend Returns a new client with the properties `fn` produces merged
 *   in, preserving everything earlier `extend` calls added. This is the
 *   viem-style decorator pattern used to attach actions.
 */
export type Client = {
  account: AnyAccount | undefined
  key: string
  name: string
  proving: ProvingConfig | undefined
  request: Transport['request']
  transport: Transport
  uid: string
  extend: <extended extends Record<string, unknown>>(
    fn: (client: Client) => extended,
  ) => Client & extended
}

/**
 * Creates a base client from a transport and optional account.
 *
 * Applies when building a custom client shape; the common cases have
 * dedicated factories ({@link createPublicClient}, `createWalletClient`,
 * `createTestClient`) that call this and attach their actions. Pure and local —
 * it wires up configuration and does not touch the network.
 *
 * @param config Transport, optional account, proving configuration, and naming.
 * @returns A client exposing `request`, its configuration, and `extend`.
 *
 * @example
 * import { createClient, http } from '@provablehq/veil-core'
 *
 * const client = createClient({
 *   transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
 * }).extend((c) => ({ blockNumber: () => c.request({ method: 'getBlockNumber' }) }))
 */
export function createClient(config: ClientConfig): Client {
  const {
    account,
    key = 'base',
    name = 'Client',
    proving,
    transport,
  } = config

  const uid = createUid()

  const client: Client = {
    account,
    key,
    name,
    proving,
    request: transport.request,
    transport,
    uid,
    extend<extended extends Record<string, unknown>>(fn: (client: Client) => extended) {
      // Build on the receiver, not the captured base client, so chained
      // extends compose: each layer's own properties (wallet actions,
      // recordProvider, decorators) stay reachable through the prototype
      // chain of the next. Rooting at `client` would discard everything a
      // prior extend() added.
      return Object.assign(Object.create(this), fn(this)) as Client & extended
    },
  }

  return client
}
