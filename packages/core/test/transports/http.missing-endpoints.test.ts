import { describe, it, expect, vi } from 'vitest'
import { http } from '../../src/transports/http.js'

/**
 * URL-mapping tests for the 16 endpoints added to http.ts. Each case verifies
 * that an action-level `client.request({ method, params })` resolves to the
 * correct Aleo REST URL on the wire.
 */
describe('http transport: new endpoint URL mappings', () => {
  const BASE = 'https://api.provable.com/v2'
  const MAINNET = `${BASE}/mainnet`

  function makeTransport() {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    })
    const transport = http(BASE, { fetchFn: mockFetch })
    return { transport, mockFetch }
  }

  it('getLatestEdition → /program/{programID}/latest_edition', async () => {
    const { transport, mockFetch } = makeTransport()
    await transport.request({ method: 'getLatestEdition', params: { programId: 'token.aleo' } })
    expect(mockFetch).toHaveBeenCalledWith(
      `${MAINNET}/program/token.aleo/latest_edition`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('getProgramByEdition → /program/{programID}/{edition}', async () => {
    const { transport, mockFetch } = makeTransport()
    await transport.request({ method: 'getProgramByEdition', params: { programId: 'token.aleo', edition: 3 } })
    expect(mockFetch).toHaveBeenCalledWith(
      `${MAINNET}/program/token.aleo/3`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('getAmendmentCount → /program/{programID}/amendment_count', async () => {
    const { transport, mockFetch } = makeTransport()
    await transport.request({ method: 'getAmendmentCount', params: { programId: 'token.aleo' } })
    expect(mockFetch).toHaveBeenCalledWith(
      `${MAINNET}/program/token.aleo/amendment_count`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('getAmendmentCountByEdition → /program/{programID}/{edition}/amendment_count', async () => {
    const { transport, mockFetch } = makeTransport()
    await transport.request({
      method: 'getAmendmentCountByEdition',
      params: { programId: 'token.aleo', edition: 2 },
    })
    expect(mockFetch).toHaveBeenCalledWith(
      `${MAINNET}/program/token.aleo/2/amendment_count`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('getDeploymentTransactionByEdition → /find/transactionID/deployment/{programID}/{edition}', async () => {
    const { transport, mockFetch } = makeTransport()
    await transport.request({
      method: 'getDeploymentTransactionByEdition',
      params: { programId: 'token.aleo', edition: 4 },
    })
    expect(mockFetch).toHaveBeenCalledWith(
      `${MAINNET}/find/transactionID/deployment/token.aleo/4`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('getOriginalDeploymentTransaction → /find/transactionID/deployment/{programID}/{edition}/original', async () => {
    const { transport, mockFetch } = makeTransport()
    await transport.request({
      method: 'getOriginalDeploymentTransaction',
      params: { programId: 'token.aleo', edition: 4 },
    })
    expect(mockFetch).toHaveBeenCalledWith(
      `${MAINNET}/find/transactionID/deployment/token.aleo/4/original`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('getAmendmentDeploymentTransaction → /find/transactionID/deployment/{programID}/{edition}/{amendment}', async () => {
    const { transport, mockFetch } = makeTransport()
    await transport.request({
      method: 'getAmendmentDeploymentTransaction',
      params: { programId: 'token.aleo', edition: 4, amendment: 2 },
    })
    expect(mockFetch).toHaveBeenCalledWith(
      `${MAINNET}/find/transactionID/deployment/token.aleo/4/2`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('getProgramCallsPaginated → /programs/{programID}/latest-calls/paginated with query params', async () => {
    const { transport, mockFetch } = makeTransport()
    await transport.request({
      method: 'getProgramCallsPaginated',
      params: {
        programId: 'token.aleo',
        limit: 20,
        cursorBlockNumber: 12345,
        cursorTransitionId: 'au1xyz',
        direction: 'next',
        sort: 'desc',
      },
    })
    const [calledUrl] = mockFetch.mock.calls[0]!
    expect(calledUrl).toContain(`${MAINNET}/programs/token.aleo/latest-calls/paginated?`)
    expect(calledUrl).toContain('limit=20')
    expect(calledUrl).toContain('cursor_block_number=12345')
    expect(calledUrl).toContain('cursor_transition_id=au1xyz')
    expect(calledUrl).toContain('direction=next')
    expect(calledUrl).toContain('sort=desc')
  })

  it('getProgramCallsPaginated omits unset query params', async () => {
    const { transport, mockFetch } = makeTransport()
    await transport.request({
      method: 'getProgramCallsPaginated',
      params: { programId: 'token.aleo' },
    })
    expect(mockFetch).toHaveBeenCalledWith(
      `${MAINNET}/programs/token.aleo/latest-calls/paginated`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('getProgramIdByAddress → /programs/{address}', async () => {
    const { transport, mockFetch } = makeTransport()
    await transport.request({ method: 'getProgramIdByAddress', params: { address: 'aleo1program' } })
    expect(mockFetch).toHaveBeenCalledWith(
      `${MAINNET}/programs/aleo1program`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('getProgramAddress → /programs/address/{programID}', async () => {
    const { transport, mockFetch } = makeTransport()
    await transport.request({ method: 'getProgramAddress', params: { programId: 'token.aleo' } })
    expect(mockFetch).toHaveBeenCalledWith(
      `${MAINNET}/programs/address/token.aleo`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('findBlockHeightByStateRoot → /find/blockHeight/{stateRoot}', async () => {
    const { transport, mockFetch } = makeTransport()
    await transport.request({ method: 'findBlockHeightByStateRoot', params: { stateRoot: 'sr1abc' } })
    expect(mockFetch).toHaveBeenCalledWith(
      `${MAINNET}/find/blockHeight/sr1abc`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('getStatePaths → /statePaths?commitments=... (comma-joined)', async () => {
    const { transport, mockFetch } = makeTransport()
    await transport.request({ method: 'getStatePaths', params: { commitments: ['c1', 'c2', 'c3'] } })
    expect(mockFetch).toHaveBeenCalledWith(
      `${MAINNET}/statePaths?commitments=${encodeURIComponent('c1,c2,c3')}`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('getBlockHeightByHash → /height/{hash}', async () => {
    const { transport, mockFetch } = makeTransport()
    await transport.request({ method: 'getBlockHeightByHash', params: { hash: 'ab1xyz' } })
    expect(mockFetch).toHaveBeenCalledWith(
      `${MAINNET}/height/ab1xyz`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('getBlockTransactionsByHash → /transactions/block/{hash}', async () => {
    const { transport, mockFetch } = makeTransport()
    await transport.request({ method: 'getBlockTransactionsByHash', params: { hash: 'ab1block' } })
    expect(mockFetch).toHaveBeenCalledWith(
      `${MAINNET}/transactions/block/ab1block`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('getTokenDetails → /tokens/details with query params', async () => {
    const { transport, mockFetch } = makeTransport()
    await transport.request({
      method: 'getTokenDetails',
      params: {
        programId: 'foo.aleo',
        tokenId: '1u128',
        limit: 25,
        offset: 10,
        granularity: 'hourly',
      },
    })
    const [calledUrl] = mockFetch.mock.calls[0]!
    expect(calledUrl).toContain(`${MAINNET}/tokens/details?`)
    expect(calledUrl).toContain('program_id=foo.aleo')
    expect(calledUrl).toContain('token_id=1u128')
    expect(calledUrl).toContain('limit=25')
    expect(calledUrl).toContain('offset=10')
    expect(calledUrl).toContain('granularity=hourly')
  })

  it('getTokenDetails omits unset optional params', async () => {
    const { transport, mockFetch } = makeTransport()
    await transport.request({ method: 'getTokenDetails', params: { programId: 'foo.aleo' } })
    expect(mockFetch).toHaveBeenCalledWith(
      `${MAINNET}/tokens/details?program_id=foo.aleo`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('getProgramMetricsByRange → /metrics/program/{programID}/range/{days}', async () => {
    const { transport, mockFetch } = makeTransport()
    await transport.request({
      method: 'getProgramMetricsByRange',
      params: { programId: 'token.aleo', days: 30 },
    })
    expect(mockFetch).toHaveBeenCalledWith(
      `${MAINNET}/metrics/program/token.aleo/range/30`,
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('respects testnet network override', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(42),
    })
    const transport = http(BASE, { fetchFn: mockFetch, network: 'testnet' })
    await transport.request({ method: 'getLatestEdition', params: { programId: 'token.aleo' } })
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/testnet/program/token.aleo/latest_edition`,
      expect.objectContaining({ method: 'GET' }),
    )
  })
})
