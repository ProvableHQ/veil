import { TransportError } from '@veil/core'
import type { Transport, TransportConfig } from '@veil/core'
import { createTransport } from '@veil/core'

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

const QUOTE_QUERY_KEYS = [
  'srcChain',
  'destChain',
  'srcAsset',
  'destAsset',
  'amountIn',
  'slippageBps',
  'fromAddress',
  'recipientAddress',
  'refundAddress',
] as const

const ORDER_BODY_KEYS = [
  'providerId',
  'integrationType',
  'srcChain',
  'destChain',
  'srcAsset',
  'destAsset',
  'amountIn',
  'slippageBps',
  'walletAddress',
  'quoteId',
  'refundAddress',
] as const

function buildRequest(
  baseUrl: string,
  method: string,
  params?: Record<string, unknown>,
): BuiltRequest {
  switch (method) {
    case 'getBridgeQuotes': {
      const q = new URLSearchParams()
      const p = params ?? {}
      for (const key of QUOTE_QUERY_KEYS) {
        const value = p[key]
        if (value != null) q.set(key, String(value))
      }
      return { url: `${baseUrl}/bridge/quotes?${q.toString()}`, httpMethod: 'GET' }
    }
    case 'createBridgeOrder': {
      const p = (params ?? {}) as Record<string, unknown>
      const headers: Record<string, string> = {}
      const timezone = p['timezone']
      if (typeof timezone === 'string' && timezone) headers['x-timezone'] = timezone
      const body: Record<string, unknown> = {}
      for (const key of ORDER_BODY_KEYS) {
        if (p[key] != null) body[key] = p[key]
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
