import { TransportError } from '../errors/errors.js'
import type { Transport } from '../types/transport.js'
import { createTransport } from './createTransport.js'

type HttpTransportConfig = {
  fetchFn?: typeof fetch | undefined
  headers?: Record<string, string> | undefined
  key?: string | undefined
  name?: string | undefined
  network?: 'mainnet' | 'testnet' | undefined
}

/**
 * Maps veil method names + params to Aleo REST API paths.
 * Aleo uses REST, not JSON-RPC, so each method maps to a URL path.
 */
function buildUrl(
  baseUrl: string,
  network: string,
  method: string,
  params?: Record<string, unknown>,
): { url: string; httpMethod: 'GET' | 'POST'; body?: string } {
  const base = `${baseUrl}/${network}`

  switch (method) {
    case 'getLatestHeight':
      return { url: `${base}/latest/height`, httpMethod: 'GET' }
    case 'getLatestBlock':
      return { url: `${base}/latest/block`, httpMethod: 'GET' }
    case 'getLatestBlockHash':
      return { url: `${base}/latest/hash`, httpMethod: 'GET' }
    case 'getBlock':
      return { url: `${base}/block/${params?.height}`, httpMethod: 'GET' }
    case 'getBlockByHash':
      return { url: `${base}/block/${params?.hash}`, httpMethod: 'GET' }
    case 'getTransaction':
      return { url: `${base}/transaction/${params?.id}`, httpMethod: 'GET' }
    case 'getBalance':
      return { url: `${base}/program/credits.aleo/mapping/account/${params?.address}`, httpMethod: 'GET' }
    case 'getProgram':
      return { url: `${base}/program/${params?.programId}`, httpMethod: 'GET' }
    case 'getMappingValue':
      return { url: `${base}/program/${params?.programId}/mapping/${params?.mapping}/${params?.key}`, httpMethod: 'GET' }
    case 'getMappingNames':
      return { url: `${base}/program/${params?.programId}/mappings`, httpMethod: 'GET' }
    case 'getStateRoot':
      return { url: `${base}/latest/stateRoot`, httpMethod: 'GET' }
    case 'getTransactions':
      return { url: `${base}/block/${params?.height}/transactions`, httpMethod: 'GET' }
    case 'getTransactionsInMempool':
      return { url: `${base}/memoryPool/transactions`, httpMethod: 'GET' }
    case 'getTransitionId':
      return { url: `${base}/find/transitionID/${params?.id}`, httpMethod: 'GET' }
    case 'sendTransaction':
      return { url: `${base}/transaction/broadcast`, httpMethod: 'POST', body: JSON.stringify(params?.transaction) }
    default:
      throw new TransportError(`Unknown method: ${method}`)
  }
}

export function http(
  url: string,
  config: HttpTransportConfig = {},
): Transport<'http'> {
  const {
    fetchFn = fetch,
    headers = {},
    key = 'http',
    name = 'HTTP Transport',
    network = 'mainnet',
  } = config

  return createTransport({
    key,
    name,
    type: 'http',
    request: async ({ method, params }) => {
      const { url: requestUrl, httpMethod, body } = buildUrl(
        url,
        network,
        method,
        params as Record<string, unknown> | undefined,
      )

      const response = await fetchFn(requestUrl, {
        method: httpMethod,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        ...(body ? { body } : {}),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new TransportError(`HTTP ${response.status}: ${text}`)
      }

      return response.json()
    },
  })
}
