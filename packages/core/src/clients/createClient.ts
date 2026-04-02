import type { AnyAccount } from '../types/account.js'
import type { ProvingConfig } from '../types/proving.js'
import type { RecordsConfig } from '../types/records.js'
import type { Transport } from '../types/transport.js'
import { uid as createUid } from '../utils/uid.js'

export type ClientConfig = {
  account?: AnyAccount | undefined
  key?: string | undefined
  name?: string | undefined
  proving?: ProvingConfig | undefined
  records?: RecordsConfig | undefined
  transport: Transport
}

export type Client = {
  account: AnyAccount | undefined
  key: string
  name: string
  proving: ProvingConfig | undefined
  records: RecordsConfig | undefined
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
    records,
    transport,
  } = config

  const uid = createUid()

  const client: Client = {
    account,
    key,
    name,
    proving,
    records,
    request: transport.request,
    transport,
    uid,
    extend(fn) {
      return Object.assign(Object.create(client), fn(client)) as Client & typeof fn extends (c: Client) => infer R ? R : never
    },
  }

  return client
}
