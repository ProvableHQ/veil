import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { http } from '../../src/transports/http.js'
import { version } from '../../src/version.js'

/**
 * Tests for the identifying client header on the HTTP transport. The header
 * is attached by default only for Provable-operated hosts (whose CORS config
 * is known to allow it); other hosts require an explicit opt-in so browser
 * requests never fail preflight against nodes Veil does not control.
 */
describe('http transport: client header', () => {
  const PROVABLE = 'https://api.provable.com/v2'
  const THIRD_PARTY = 'https://my-node.example.com/v2'

  function makeTransport(url: string, config?: Parameters<typeof http>[1]) {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    })
    const transport = http(url, { fetchFn: mockFetch, ...config })
    return { transport, mockFetch }
  }

  function sentHeaders(mockFetch: ReturnType<typeof vi.fn>): Record<string, string> {
    return mockFetch.mock.calls[0][1].headers
  }

  it('attaches X-Veil-Client to provable.com hosts by default', async () => {
    const { transport, mockFetch } = makeTransport(PROVABLE)
    await transport.request({ method: 'getLatestHeight' })
    expect(sentHeaders(mockFetch)['X-Veil-Client']).toBe(`veil-core/${version}`)
  })

  it('omits the header for non-Provable hosts by default', async () => {
    const { transport, mockFetch } = makeTransport(THIRD_PARTY)
    await transport.request({ method: 'getLatestHeight' })
    expect(sentHeaders(mockFetch)).not.toHaveProperty('X-Veil-Client')
  })

  it('is not fooled by hostnames that merely end in "provable.com"', async () => {
    const { transport, mockFetch } = makeTransport('https://evilprovable.com/v2')
    await transport.request({ method: 'getLatestHeight' })
    expect(sentHeaders(mockFetch)).not.toHaveProperty('X-Veil-Client')
  })

  it('a clientHeader string customizes the value for Provable hosts', async () => {
    const { transport, mockFetch } = makeTransport(PROVABLE, { clientHeader: 'my-dapp/1.2' })
    await transport.request({ method: 'getLatestHeight' })
    expect(sentHeaders(mockFetch)['X-Veil-Client']).toBe('my-dapp/1.2')
  })

  it('a clientHeader string is still not sent to non-Provable hosts', async () => {
    const { transport, mockFetch } = makeTransport(THIRD_PARTY, { clientHeader: 'my-dapp/1.2' })
    await transport.request({ method: 'getLatestHeight' })
    expect(sentHeaders(mockFetch)).not.toHaveProperty('X-Veil-Client')
  })

  it('headers config can attach an identifying header to any host', async () => {
    const { transport, mockFetch } = makeTransport(THIRD_PARTY, {
      headers: { 'X-Veil-Client': 'my-dapp/1.2' },
    })
    await transport.request({ method: 'getLatestHeight' })
    expect(sentHeaders(mockFetch)['X-Veil-Client']).toBe('my-dapp/1.2')
  })

  it('clientHeader: false disables the header everywhere', async () => {
    const { transport, mockFetch } = makeTransport(PROVABLE, { clientHeader: false })
    await transport.request({ method: 'getLatestHeight' })
    expect(sentHeaders(mockFetch)).not.toHaveProperty('X-Veil-Client')
  })

  it('user-supplied headers override the default header', async () => {
    const { transport, mockFetch } = makeTransport(PROVABLE, {
      headers: { 'X-Veil-Client': 'custom/0.0.1' },
    })
    await transport.request({ method: 'getLatestHeight' })
    expect(sentHeaders(mockFetch)['X-Veil-Client']).toBe('custom/0.0.1')
  })

  it('user headers override the default regardless of key casing', async () => {
    const { transport, mockFetch } = makeTransport(PROVABLE, {
      headers: { 'x-veil-client': 'custom/0.0.1' },
    })
    await transport.request({ method: 'getLatestHeight' })
    const headers = sentHeaders(mockFetch)
    // Fetch's Headers combines case-variant duplicate keys into one value on
    // the wire, so the default must not be attached alongside the override.
    expect(headers).not.toHaveProperty('X-Veil-Client')
    expect(headers['x-veil-client']).toBe('custom/0.0.1')
  })

  it('an empty-string clientHeader is treated as unset and sends the default', async () => {
    const { transport, mockFetch } = makeTransport(PROVABLE, { clientHeader: '' })
    await transport.request({ method: 'getLatestHeight' })
    expect(sentHeaders(mockFetch)['X-Veil-Client']).toBe(`veil-core/${version}`)
  })

  it('omits the header when the transport URL is unparseable', async () => {
    const { transport, mockFetch } = makeTransport('not a url')
    await transport.request({ method: 'getLatestHeight' })
    expect(sentHeaders(mockFetch)).not.toHaveProperty('X-Veil-Client')
  })

  it('version constant matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(version).toBe(pkg.version)
  })

  it('version is exported from the package index', async () => {
    const index = await import('../../src/index.js')
    expect(index.version).toBe(version)
  })
})
