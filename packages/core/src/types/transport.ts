import type { Network } from './wallet.js'

/**
 * Sends one named request over a transport and resolves with the untyped result.
 *
 * @property method Veil method name the transport maps to a wire request.
 * @property params Optional method parameters. Defaults to none.
 * @property clientHeaders Optional identifying headers for this one request,
 *   such as the SDK and action that issued it. Defaults to none. The HTTP
 *   transport sends them only to Provable-operated hosts and drops them when
 *   `clientHeader` is `false`; other transports may ignore them. Use for
 *   usage attribution only. Do not put credentials or routing headers here;
 *   those belong in the transport's `headers` config.
 */
export type RequestFn = (args: {
  method: string
  params?: unknown
  clientHeaders?: Record<string, string> | undefined
}) => Promise<unknown>

/**
 * Configuration a transport is constructed with.
 *
 * @property key Stable identifier for the transport kind (e.g. "http").
 * @property name Human-readable transport name.
 * @property type Transport kind, carried in the type parameter for narrowing.
 * @property retryCount Maximum retry attempts for a failed request.
 * @property retryDelay Delay between retries, in milliseconds.
 * @property timeout Request timeout in milliseconds.
 */
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

/** An instantiated transport: its config plus the request function clients call. */
export type Transport<type extends string = string> = {
  config: TransportConfig<type>
  request: RequestFn
}
