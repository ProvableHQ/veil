import { TransportError } from '../errors/errors.js'
import type { Transport, TransportConfig } from '../types/transport.js'
import type { Network } from '../types/wallet.js'
import { createTransport } from './createTransport.js'

type HttpTransportConfig = {
  fetchFn?: typeof fetch | undefined
  headers?: Record<string, string> | undefined
  key?: string | undefined
  name?: string | undefined
  network?: Network | undefined
}

/**
 * Encodes a user-supplied value for safe inclusion in a URL path segment.
 * Returns an empty string for null/undefined — the resulting malformed URL
 * fails informatively at the server instead of being misrouted.
 */
function enc(v: unknown): string {
  if (v === null || v === undefined) return ''
  return encodeURIComponent(String(v))
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
      return { url: `${base}/block/${enc(params?.height ?? params?.hash)}`, httpMethod: 'GET' }
    case 'getBlockByHash':
      return { url: `${base}/block/${enc(params?.hash)}`, httpMethod: 'GET' }
    case 'getBlockTransactions':
    case 'getTransactions':
      return { url: `${base}/block/${enc(params?.height)}/transactions`, httpMethod: 'GET' }
    case 'getBlocks': {
      const q = new URLSearchParams()
      if (params?.start != null) q.set('start', String(params.start))
      if (params?.end != null) q.set('end', String(params.end))
      return { url: `${base}/blocks?${q.toString()}`, httpMethod: 'GET' }
    }
    case 'getBlockSummary':
      return { url: `${base}/blocks/summary/latest`, httpMethod: 'GET' }
    case 'getStateRoot':
      return params?.height != null
        ? { url: `${base}/stateRoot/${enc(params.height)}`, httpMethod: 'GET' }
        : { url: `${base}/stateRoot/latest`, httpMethod: 'GET' }
    case 'getStatePath':
      return { url: `${base}/statePath/${enc(params?.commitment)}`, httpMethod: 'GET' }
    case 'findBlockHash':
      return { url: `${base}/find/blockHash/${enc(params?.transactionId)}`, httpMethod: 'GET' }

    // --- Transaction ---
    case 'getTransaction':
      return { url: `${base}/transaction/${enc(params?.id)}`, httpMethod: 'GET' }
    case 'getConfirmedTransaction':
      return { url: `${base}/transaction/confirmed/${enc(params?.id)}`, httpMethod: 'GET' }
    case 'getUnconfirmedTransaction':
      return { url: `${base}/transaction/unconfirmed/${enc(params?.id)}`, httpMethod: 'GET' }
    case 'getTransactionsByAddress':
      return { url: `${base}/transactions/address/${enc(params?.address)}`, httpMethod: 'GET' }
    case 'getTransactionSummary':
      return { url: `${base}/transactions/summary/latest`, httpMethod: 'GET' }
    case 'findTransactionId':
      return { url: `${base}/find/transactionID/${enc(params?.transitionId)}`, httpMethod: 'GET' }
    case 'sendTransaction':
      return { url: `${base}/transaction/broadcast`, httpMethod: 'POST', body: params?.transaction as string }

    // --- Transition ---
    case 'getTransitions':
      return { url: `${base}/transitions/${enc(params?.address)}`, httpMethod: 'GET' }
    case 'findTransitionId':
    case 'getTransitionId':
      return { url: `${base}/find/transitionID/${enc(params?.inputOrOutputId ?? params?.id)}`, httpMethod: 'GET' }

    // --- Program ---
    case 'getProgram':
      return { url: `${base}/program/${enc(params?.programId)}`, httpMethod: 'GET' }
    case 'getMappingValue':
      return { url: `${base}/program/${enc(params?.programId)}/mapping/${enc(params?.mapping)}/${enc(params?.key)}`, httpMethod: 'GET' }
    case 'getMappingNames':
      return { url: `${base}/program/${enc(params?.programId)}/mappings`, httpMethod: 'GET' }
    case 'getDeploymentTransaction':
      return { url: `${base}/find/transactionID/deployment/${enc(params?.programId)}`, httpMethod: 'GET' }
    case 'getProgramCalls':
      return { url: `${base}/programs/${enc(params?.programId)}/latest-calls`, httpMethod: 'GET' }
    case 'getProgramCallsPaginated': {
      const q = new URLSearchParams()
      if (params?.limit != null) q.set('limit', String(params.limit))
      if (params?.cursorBlockNumber != null) q.set('cursor_block_number', String(params.cursorBlockNumber))
      if (params?.cursorTransitionId != null) q.set('cursor_transition_id', String(params.cursorTransitionId))
      if (params?.direction != null) q.set('direction', String(params.direction))
      if (params?.sort != null) q.set('sort', String(params.sort))
      const qs = q.toString()
      return {
        url: `${base}/programs/${enc(params?.programId)}/latest-calls/paginated${qs ? `?${qs}` : ''}`,
        httpMethod: 'GET',
      }
    }
    case 'getLatestEdition':
      return { url: `${base}/program/${enc(params?.programId)}/latest_edition`, httpMethod: 'GET' }
    case 'getProgramByEdition':
      return { url: `${base}/program/${enc(params?.programId)}/${enc(params?.edition)}`, httpMethod: 'GET' }
    case 'getAmendmentCount':
      return { url: `${base}/program/${enc(params?.programId)}/amendment_count`, httpMethod: 'GET' }
    case 'getAmendmentCountByEdition':
      return { url: `${base}/program/${enc(params?.programId)}/${enc(params?.edition)}/amendment_count`, httpMethod: 'GET' }
    case 'getDeploymentTransactionByEdition':
      return { url: `${base}/find/transactionID/deployment/${enc(params?.programId)}/${enc(params?.edition)}`, httpMethod: 'GET' }
    case 'getOriginalDeploymentTransaction':
      return { url: `${base}/find/transactionID/deployment/${enc(params?.programId)}/${enc(params?.edition)}/original`, httpMethod: 'GET' }
    case 'getAmendmentDeploymentTransaction':
      return {
        url: `${base}/find/transactionID/deployment/${enc(params?.programId)}/${enc(params?.edition)}/${enc(params?.amendment)}`,
        httpMethod: 'GET',
      }
    case 'getProgramIdByAddress':
      return { url: `${base}/programs/${enc(params?.address)}`, httpMethod: 'GET' }
    case 'getProgramAddress':
      return { url: `${base}/programs/address/${enc(params?.programId)}`, httpMethod: 'GET' }
    case 'findBlockHeightByStateRoot':
      return { url: `${base}/find/blockHeight/${enc(params?.stateRoot)}`, httpMethod: 'GET' }
    case 'getStatePaths': {
      const commitments = Array.isArray(params?.commitments) ? (params.commitments as string[]).join(',') : ''
      const q = new URLSearchParams()
      q.set('commitments', commitments)
      return { url: `${base}/statePaths?${q.toString()}`, httpMethod: 'GET' }
    }
    case 'getBlockHeightByHash':
      return { url: `${base}/height/${enc(params?.hash)}`, httpMethod: 'GET' }
    case 'getBlockTransactionsByHash':
      return { url: `${base}/transactions/block/${enc(params?.hash)}`, httpMethod: 'GET' }
    case 'getTokenDetails': {
      const q = new URLSearchParams()
      if (params?.programId != null) q.set('program_id', String(params.programId))
      if (params?.tokenId != null) q.set('token_id', String(params.tokenId))
      if (params?.limit != null) q.set('limit', String(params.limit))
      if (params?.offset != null) q.set('offset', String(params.offset))
      if (params?.granularity != null) q.set('granularity', String(params.granularity))
      const qs = q.toString()
      return { url: `${base}/tokens/details${qs ? `?${qs}` : ''}`, httpMethod: 'GET' }
    }
    case 'getProgramMetricsByRange':
      return { url: `${base}/metrics/program/${enc(params?.programId)}/range/${enc(params?.days)}`, httpMethod: 'GET' }

    // --- Account ---
    case 'getBalance':
      return { url: `${base}/program/credits.aleo/mapping/account/${enc(params?.address)}`, httpMethod: 'GET' }

    // --- Committee / Staking ---
    case 'getCommittee':
      return params?.height != null
        ? { url: `${base}/committee/${enc(params.height)}`, httpMethod: 'GET' }
        : { url: `${base}/committee/latest`, httpMethod: 'GET' }
    case 'getDelegators':
      return { url: `${base}/delegators/${enc(params?.validator)}`, httpMethod: 'GET' }
    case 'getStakingEarnings':
      return { url: `${base}/earnings/${enc(params?.address)}`, httpMethod: 'GET' }

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

    // --- Development (devnode only) ---
    case 'advanceBlock':
      return { url: `${base}/block/create`, httpMethod: 'POST', body: JSON.stringify({ count: (params as Record<string, unknown>)?.count ?? 1 }) }
    case 'shutdown':
      return { url: `${base}/shutdown`, httpMethod: 'POST' }
    case 'getMappingKeysValues':
      return { url: `${base}/program/${params?.programId}/mapping/${params?.mapping}?all=true`, httpMethod: 'GET' }
    case 'snapshot':
      return {
        url: `${base}/snapshot`,
        httpMethod: 'POST',
        body: JSON.stringify(params?.name != null ? { name: params.name } : {}),
      }
    case 'listSnapshots':
      return { url: `${base}/snapshots`, httpMethod: 'GET' }

    default:
      throw new TransportError(`Unknown method: ${method}`)
  }
}

/**
 * Creates an HTTP transport that talks to an Aleo REST node.
 *
 * The default transport for reading the chain and broadcasting transactions:
 * it maps each veil method to a REST path under `{url}/{network}` and issues
 * the request. Building the transport is pure; each call performs a network
 * request and throws on a non-2xx response.
 *
 * @param url Base URL of the Aleo node, without a trailing network segment
 *   (e.g. `https://api.provable.com/v2`).
 * @param config Optional transport settings.
 * @param config.fetchFn Optional `fetch` implementation to use for requests.
 *   Defaults to the global `fetch`; supply one for non-browser runtimes or tests.
 * @param config.headers Optional headers merged into every request. Defaults to
 *   none; use it for auth tokens or custom routing.
 * @param config.key Optional transport key. Defaults to `'http'`.
 * @param config.name Optional human-readable name. Defaults to `'HTTP Transport'`.
 * @param config.network Optional network whose segment is used in request paths.
 *   Defaults to `'mainnet'`. For local accounts, `switchChain` mutates this to
 *   re-route reads.
 * @returns A transport of type `'http'` bound to `url` and the chosen network.
 *
 * @example
 * import { http } from '@veil/core'
 *
 * const transport = http('https://api.provable.com/v2', { network: 'testnet' })
 */
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

  // Build the config object first so the request closure can read
  // `transportConfig.network` on every call. `switchChain` for local accounts
  // mutates this field to re-route reads at the new network's path segment.
  const transportConfig: TransportConfig<'http'> = {
    key,
    name,
    type: 'http',
    network,
    request: async ({ method, params }) => {
      const currentNetwork = String(transportConfig.network ?? 'mainnet')
      const { url: requestUrl, httpMethod, body } = buildUrl(
        url,
        currentNetwork,
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
  }

  return createTransport(transportConfig)
}
