import { describe, it, expect, vi } from 'vitest'
import { createPublicClient } from '../../../src/clients/createPublicClient.js'
import { publicActions } from '../../../src/clients/decorators/public.js'
import { http } from '../../../src/transports/http.js'
import { TransportError } from '../../../src/errors/errors.js'

/**
 * Error-path tests for the 16 new publicClient actions.
 *
 * Two layers of coverage per action:
 *  (a) Transport-level — non-ok HTTP responses surface as TransportError
 *  (b) Action-level — arbitrary request() rejections propagate unchanged
 */

type ActionCall = {
  name: string
  run: (client: any) => Promise<unknown>
}

const ACTIONS: ActionCall[] = [
  { name: 'getLatestEdition', run: (c) => c.getLatestEdition({ programId: 'token.aleo' }) },
  { name: 'getProgramByEdition', run: (c) => c.getProgramByEdition({ programId: 'token.aleo', edition: 3 }) },
  { name: 'getAmendmentCount', run: (c) => c.getAmendmentCount({ programId: 'token.aleo' }) },
  { name: 'getAmendmentCountByEdition', run: (c) => c.getAmendmentCountByEdition({ programId: 'token.aleo', edition: 2 }) },
  { name: 'getDeploymentTransactionByEdition', run: (c) => c.getDeploymentTransactionByEdition({ programId: 'token.aleo', edition: 4 }) },
  { name: 'getOriginalDeploymentTransaction', run: (c) => c.getOriginalDeploymentTransaction({ programId: 'token.aleo', edition: 4 }) },
  { name: 'getAmendmentDeploymentTransaction', run: (c) => c.getAmendmentDeploymentTransaction({ programId: 'token.aleo', edition: 4, amendment: 2 }) },
  { name: 'getProgramCallsPaginated', run: (c) => c.getProgramCallsPaginated({ programId: 'token.aleo' }) },
  { name: 'getProgramIdByAddress', run: (c) => c.getProgramIdByAddress({ address: 'aleo1program' }) },
  { name: 'getProgramAddress', run: (c) => c.getProgramAddress({ programId: 'token.aleo' }) },
  { name: 'findBlockHeightByStateRoot', run: (c) => c.findBlockHeightByStateRoot({ stateRoot: 'sr1abc' }) },
  { name: 'getStatePaths', run: (c) => c.getStatePaths({ commitments: ['c1'] }) },
  { name: 'getBlockHeightByHash', run: (c) => c.getBlockHeightByHash({ hash: 'ab1block' }) },
  { name: 'getBlockTransactionsByHash', run: (c) => c.getBlockTransactionsByHash({ hash: 'ab1block' }) },
  { name: 'getTokenDetails', run: (c) => c.getTokenDetails({ programId: 'foo.aleo' }) },
  { name: 'getProgramMetricsByRange', run: (c) => c.getProgramMetricsByRange({ programId: 'token.aleo', days: 30 }) },
]

describe('publicClient actions — transport error surfacing (404)', () => {
  for (const { name, run } of ACTIONS) {
    it(`${name} surfaces HTTP 404 as TransportError`, async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found'),
      })
      const client = createPublicClient({ transport: http('https://api.example.com/v2', { fetchFn: mockFetch }) })
      await expect(run(client)).rejects.toThrow(TransportError)
      await expect(run(client)).rejects.toThrow(/HTTP 404/)
    })
  }
})

describe('publicClient actions — transport error surfacing (500)', () => {
  for (const { name, run } of ACTIONS) {
    it(`${name} surfaces HTTP 500 as TransportError`, async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      })
      const client = createPublicClient({ transport: http('https://api.example.com/v2', { fetchFn: mockFetch }) })
      await expect(run(client)).rejects.toThrow(/HTTP 500/)
    })
  }
})

describe('publicClient actions — network failure propagation', () => {
  for (const { name, run } of ACTIONS) {
    it(`${name} propagates network errors from fetch`, async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:3030'))
      const client = createPublicClient({ transport: http('https://api.example.com/v2', { fetchFn: mockFetch }) })
      await expect(run(client)).rejects.toThrow(/ECONNREFUSED/)
    })
  }
})

describe('publicClient actions — action-level rejection passthrough', () => {
  // Verifies that actions don't swallow, wrap, or transform errors from client.request.
  for (const { name, run } of ACTIONS) {
    it(`${name} passes through the original error instance`, async () => {
      const boom = new Error(`${name} specific error`)
      const client: any = {
        request: vi.fn().mockRejectedValue(boom),
        // Needed for the decorator-produced client shape — tests call the decorated method directly.
      }
      // Build a minimal decorated client from the mocked request-only client.
      const decorated = { ...client, ...publicActions(client) }
      await expect(run(decorated)).rejects.toBe(boom)
    })
  }
})
