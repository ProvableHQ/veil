import type { RequestFn, Transport } from '../types/transport.js'
import { createTransport } from './createTransport.js'

type CustomTransportConfig = {
  request: RequestFn
  key?: string | undefined
  name?: string | undefined
}

export function custom(config: CustomTransportConfig): Transport<'custom'> {
  const { request, key = 'custom', name = 'Custom Transport' } = config
  return createTransport({ key, name, type: 'custom', request })
}
