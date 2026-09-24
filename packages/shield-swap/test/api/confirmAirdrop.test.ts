import { describe, it, expect, vi } from 'vitest'
import { ApiClient, ApiError, DEFAULT_API_URL } from '../../src/api/client.js'

function fetchMock(responses: Array<{ status?: number; json: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  let i = 0
  const impl = vi.fn(async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const r = responses[Math.min(i++, responses.length - 1)]!
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 })
  }) as unknown as typeof fetch
  return { impl, calls }
}

const RESULTS = [
  { symbol: 'ETH', amm_token_program: 'test_arc20_eth.aleo', amount: '1000', status: 'accepted', tx_id: 'at1a' },
  { symbol: 'USDC', amm_token_program: 'test_arc20_usdc.aleo', amount: '1000', status: 'rejected', tx_id: 'at1b' },
]

describe('ApiClient.confirmAirdrop', () => {
  it('starts the job, polls while running, and returns the settled job', async () => {
    const { impl, calls } = fetchMock([
      { json: { data: { job_id: 'job-1', status: 'running' } } },
      { json: { data: { status: 'running', total: 2, results: [RESULTS[0]] } } },
      { json: { data: { status: 'complete', total: 2, results: RESULTS } } },
    ])
    const api = new ApiClient({ fetch: impl, apiToken: 'ss_test' })

    const outcome = await api.confirmAirdrop('aleo1me', { pollIntervalMs: 1 })

    expect(outcome).toEqual({ status: 'settled', job: { status: 'complete', total: 2, results: RESULTS } })
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      `POST ${DEFAULT_API_URL}/airdrop`,
      `GET ${DEFAULT_API_URL}/airdrop/job-1`,
      `GET ${DEFAULT_API_URL}/airdrop/job-1`,
    ])
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ address: 'aleo1me' })
  })

  it('reports a rate-limited faucet instead of throwing', async () => {
    const { impl, calls } = fetchMock([
      { status: 429, json: { error: 'airdrop already claimed for this address; try again in 15 minutes' } },
    ])
    const api = new ApiClient({ fetch: impl, apiToken: 'ss_test' })

    const outcome = await api.confirmAirdrop('aleo1me', { pollIntervalMs: 1 })

    expect(outcome.status).toBe('rate_limited')
    expect(outcome.status === 'rate_limited' && outcome.message).toMatch(/15 minutes/)
    // Nothing started, so nothing is polled.
    expect(calls).toHaveLength(1)
  })

  it('propagates every other API error', async () => {
    const { impl } = fetchMock([{ status: 401, json: { error: 'unauthorized' } }])
    const api = new ApiClient({ fetch: impl, apiToken: 'ss_test' })

    const err = await api.confirmAirdrop('aleo1me', { pollIntervalMs: 1 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(401)
  })

  it('gives up with the job id and progress once the timeout passes', async () => {
    const { impl } = fetchMock([
      { json: { data: { job_id: 'job-2', status: 'running' } } },
      { json: { data: { status: 'running', total: 2, results: [RESULTS[0]] } } },
    ])
    const api = new ApiClient({ fetch: impl, apiToken: 'ss_test' })

    await expect(api.confirmAirdrop('aleo1me', { pollIntervalMs: 1, timeoutMs: 0 })).rejects.toThrow(
      /job job-2 is still running after 0ms \(1 of 2 tokens landed\)/,
    )
  })
})
