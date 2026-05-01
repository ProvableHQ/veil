import type { Network } from './wallet.js'

export type RequestFn = (args: {
  method: string
  params?: unknown
}) => Promise<unknown>

export type TransportConfig<type extends string = string> = {
  key: string
  name: string
  request: RequestFn
  type: type
  retryCount?: number | undefined
  retryDelay?: number | undefined
  timeout?: number | undefined
  /** Network this transport is bound to, when applicable. */
  network?: Network | null | undefined
}

export type Transport<type extends string = string> = {
  config: TransportConfig<type>
  request: RequestFn
}
