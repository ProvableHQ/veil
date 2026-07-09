import { TransportError } from '@provablehq/veil-core'
import type { Transport, TransportConfig } from '@provablehq/veil-core'
import { createTransport } from '@provablehq/veil-core'

/**
 * Configuration for {@link httpBridge}.
 *
 * @property fetchFn Fetch implementation to use. Defaults to the global `fetch`.
 * @property headers Extra headers sent with every request (e.g. auth).
 * @property key Transport key. Defaults to `'httpBridge'`.
 * @property name Transport name. Defaults to `'HTTP Bridge Transport'`.
 */
type HttpBridgeConfig = {
  fetchFn?: typeof fetch | undefined
  headers?: Record<string, string> | undefined
  key?: string | undefined
  name?: string | undefined
}

function enc(v: unknown): string {
  if (v === null || v === undefined) return ''
  return encodeURIComponent(String(v))
}

type BuiltRequest = {
  url: string
  httpMethod: 'GET' | 'POST'
  body?: string
  headers?: Record<string, string>
}

/**
 * Builds each bridge method's HTTP request. The typed action parameters own
 * the wire contract — params are forwarded wholesale (minus transport-level
 * fields like `timezone`), so adding a field to an action's parameter type is
 * enough for it to reach the API.
 */
function buildRequest(
  baseUrl: string,
  method: string,
  params?: Record<string, unknown>,
): BuiltRequest {
  switch (method) {
    case 'getBridgeAssets':
      return { url: `${baseUrl}/common/assets`, httpMethod: 'GET' }
    case 'getBridgeProviders':
      return { url: `${baseUrl}/common/providers`, httpMethod: 'GET' }
    case 'getBridgeFlags':
      return { url: `${baseUrl}/bridge/flags`, httpMethod: 'GET' }
    case 'getBridgeQuotes': {
      const q = new URLSearchParams()
      for (const [key, value] of Object.entries(params ?? {})) {
        if (value != null) q.set(key, String(value))
      }
      return { url: `${baseUrl}/bridge/quotes?${q.toString()}`, httpMethod: 'GET' }
    }
    case 'createBridgeOrder': {
      // timezone travels as the x-timezone header, not in the body.
      const { timezone, ...rest } = params ?? {}
      const headers: Record<string, string> = {}
      if (typeof timezone === 'string' && timezone) headers['x-timezone'] = timezone
      const body: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(rest)) {
        if (value != null) body[key] = value
      }
      return {
        url: `${baseUrl}/bridge/orders`,
        httpMethod: 'POST',
        body: JSON.stringify(body),
        headers,
      }
    }
    case 'getBridgeOrder':
      return {
        url: `${baseUrl}/bridge/orders/${enc((params as Record<string, unknown> | undefined)?.id)}`,
        httpMethod: 'GET',
      }
    case 'getBridgeOrderAudit':
      return {
        url: `${baseUrl}/bridge/orders/${enc((params as Record<string, unknown> | undefined)?.id)}/audit`,
        httpMethod: 'GET',
      }
    default:
      throw new TransportError(`Unknown bridge method: ${method}`)
  }
}

/**
 * Creates a transport speaking the bridge REST API (`/bridge/*` on the
 * wallet-services API).
 *
 * Maps the bridge client's request methods (`getBridgeQuotes`,
 * `createBridgeOrder`, …) onto their HTTP routes. Every request hits the
 * network; non-2xx responses throw `TransportError` with the response body in
 * the message.
 *
 * @param baseUrl The API origin, without a trailing path — e.g.
 *   `https://wallet.api.provable.com`.
 * @param config Optional fetch/header/identity overrides — see the config type.
 * @returns A transport to pass to `createBridgeClient`.
 * @throws TransportError From requests: unknown method, or a non-2xx response.
 *
 * @example
 * const bridge = createBridgeClient({
 *   transport: httpBridge('https://wallet.api.provable.com'),
 * })
 */
export function httpBridge(
  baseUrl: string,
  config: HttpBridgeConfig = {},
): Transport<'httpBridge'> {
  const {
    fetchFn = fetch,
    headers: extraHeaders = {},
    key = 'httpBridge',
    name = 'HTTP Bridge Transport',
  } = config

  const transportConfig: TransportConfig<'httpBridge'> = {
    key,
    name,
    type: 'httpBridge',
    request: async ({ method, params }) => {
      const built = buildRequest(baseUrl, method, params as Record<string, unknown> | undefined)
      const response = await fetchFn(built.url, {
        method: built.httpMethod,
        headers: {
          ...(built.body ? { 'Content-Type': 'application/json' } : {}),
          ...extraHeaders,
          ...built.headers,
        },
        ...(built.body ? { body: built.body } : {}),
      })
      if (!response.ok) {
        const text = await response.text()
        throw new TransportError(`HTTP ${response.status}: ${text}`)
      }
      return response.json()
    },
  }

  return createTransport(transportConfig)
}
