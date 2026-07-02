import type { AnyAccount } from '../types/account.js'
import type { ProvingConfig } from '../types/proving.js'
import type { RecordProvider } from '../types/records.js'
import type { Transport } from '../types/transport.js'
import { uid as createUid } from '../utils/uid.js'

export type ClientConfig = {
  account?: AnyAccount | undefined
  key?: string | undefined
  name?: string | undefined
  proving?: ProvingConfig | undefined
  transport: Transport
}

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
