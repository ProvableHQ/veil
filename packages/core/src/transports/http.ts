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
    // --- Block ---
    case 'getLatestHeight':
      return { url: `${base}/block/height/latest`, httpMethod: 'GET' }
    case 'getLatestBlock':
      return { url: `${base}/block/latest`, httpMethod: 'GET' }
    case 'getLatestBlockHash':
    case 'getBlockHashLatest':
      return { url: `${base}/block/hash/latest`, httpMethod: 'GET' }
    case 'getBlock':
      return { url: `${base}/block/${params?.height ?? params?.hash}`, httpMethod: 'GET' }
    case 'getBlockByHash':
      return { url: `${base}/block/${params?.hash}`, httpMethod: 'GET' }
    case 'getBlockTransactions':
    case 'getTransactions':
      return { url: `${base}/block/${params?.height}/transactions`, httpMethod: 'GET' }
    case 'getBlocks':
      return { url: `${base}/blocks?start=${params?.start}&end=${params?.end}`, httpMethod: 'GET' }
    case 'getBlockSummary':
      return { url: `${base}/blocks/summary/latest`, httpMethod: 'GET' }
    case 'getStateRoot':
      return params?.height != null
        ? { url: `${base}/stateRoot/${params.height}`, httpMethod: 'GET' }
        : { url: `${base}/stateRoot/latest`, httpMethod: 'GET' }
    case 'getStatePath':
      return { url: `${base}/statePath/${params?.commitment}`, httpMethod: 'GET' }
    case 'findBlockHash':
      return { url: `${base}/find/blockHash/${params?.transactionId}`, httpMethod: 'GET' }

    // --- Transaction ---
    case 'getTransaction':
      return { url: `${base}/transaction/${params?.id}`, httpMethod: 'GET' }
    case 'getConfirmedTransaction':
      return { url: `${base}/transaction/confirmed/${params?.id}`, httpMethod: 'GET' }
    case 'getUnconfirmedTransaction':
      return { url: `${base}/transaction/unconfirmed/${params?.id}`, httpMethod: 'GET' }
    case 'getTransactionsByAddress':
      return { url: `${base}/transactions/address/${params?.address}`, httpMethod: 'GET' }
    case 'getTransactionSummary':
      return { url: `${base}/transactions/summary/latest`, httpMethod: 'GET' }
    case 'findTransactionId':
      return { url: `${base}/find/transactionID/${params?.transitionId}`, httpMethod: 'GET' }
    case 'sendTransaction':
      return { url: `${base}/transaction/broadcast`, httpMethod: 'POST', body: JSON.stringify(params?.transaction) }

    // --- Transition ---
    case 'getTransitions':
      return { url: `${base}/transitions/${params?.address}`, httpMethod: 'GET' }
    case 'findTransitionId':
    case 'getTransitionId':
      return { url: `${base}/find/transitionID/${params?.inputOrOutputId ?? params?.id}`, httpMethod: 'GET' }

    // --- Program ---
    case 'getProgram':
      return { url: `${base}/program/${params?.programId}`, httpMethod: 'GET' }
    case 'getMappingValue':
      return { url: `${base}/program/${params?.programId}/mapping/${params?.mapping}/${params?.key}`, httpMethod: 'GET' }
    case 'getMappingNames':
      return { url: `${base}/program/${params?.programId}/mappings`, httpMethod: 'GET' }
    case 'getDeploymentTransaction':
      return { url: `${base}/find/transactionID/deployment/${params?.programId}`, httpMethod: 'GET' }
    case 'getProgramCalls':
      return { url: `${base}/programs/${params?.programId}/latest-calls`, httpMethod: 'GET' }

    // --- Account ---
    case 'getBalance':
      return { url: `${base}/program/credits.aleo/mapping/account/${params?.address}`, httpMethod: 'GET' }

    // --- Committee / Staking ---
    case 'getCommittee':
      return params?.height != null
        ? { url: `${base}/committee/${params.height}`, httpMethod: 'GET' }
        : { url: `${base}/committee/latest`, httpMethod: 'GET' }
    case 'getDelegators':
      return { url: `${base}/delegators/${params?.validator}`, httpMethod: 'GET' }
    case 'getStakingEarnings':
      return { url: `${base}/earnings/${params?.address}`, httpMethod: 'GET' }

    // --- Metrics ---
    case 'getTransactionMetrics':
      return { url: `${base}/metrics/transactions`, httpMethod: 'GET' }
    case 'getProgramMetrics':
      return { url: `${base}/metrics/programs`, httpMethod: 'GET' }
    case 'getApy':
      return { url: `${base}/metrics/apy`, httpMethod: 'GET' }
    case 'getValidatorApy':
      return { url: `${base}/metrics/validators/apy`, httpMethod: 'GET' }

    // --- Supply ---
    case 'getTotalSupply':
      return { url: `${base}/latest/totalSupply`, httpMethod: 'GET' }
    case 'getCirculatingSupply':
      return { url: `${base}/latest/circulatingSupply`, httpMethod: 'GET' }

    // --- Tokens / DeFi ---
    case 'getTvl':
      return { url: `${base}/defi/totalValue`, httpMethod: 'GET' }
    case 'getTokens':
      return { url: `${base}/tokens`, httpMethod: 'GET' }

    // --- Mempool ---
    case 'getTransactionsInMempool':
      return { url: `${base}/memoryPool/transactions`, httpMethod: 'GET' }

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
