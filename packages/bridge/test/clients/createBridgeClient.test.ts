import { describe, it, expect, vi } from 'vitest'
import { createBridgeClient } from '../../src/clients/createBridgeClient.js'
import { httpBridge } from '../../src/transports/httpBridge.js'

describe('createBridgeClient', () => {
  it('exposes a request function from the transport', () => {
    const fetchFn = vi.fn()
    const client = createBridgeClient({
      transport: httpBridge('https://wsa.example/api', { fetchFn: fetchFn as unknown as typeof fetch }),
    })
    expect(typeof client.request).toBe('function')
  })

  it('has the bridge key by default', () => {
    const fetchFn = vi.fn()
    const client = createBridgeClient({
      transport: httpBridge('https://wsa.example/api', { fetchFn: fetchFn as unknown as typeof fetch }),
    })
    expect(client.key).toBe('bridge')
  })

  it('has Bridge Client name by default', () => {
    const fetchFn = vi.fn()
    const client = createBridgeClient({
      transport: httpBridge('https://wsa.example/api', { fetchFn: fetchFn as unknown as typeof fetch }),
    })
    expect(client.name).toBe('Bridge Client')
  })

  it('respects custom key and name', () => {
    const fetchFn = vi.fn()
    const client = createBridgeClient({
      transport: httpBridge('https://wsa.example/api', { fetchFn: fetchFn as unknown as typeof fetch }),
      key: 'custom-bridge',
      name: 'My Bridge',
    })
    expect(client.key).toBe('custom-bridge')
    expect(client.name).toBe('My Bridge')
  })

  it('is extendable like other Veil clients', () => {
    const fetchFn = vi.fn()
    const client = createBridgeClient({
      transport: httpBridge('https://wsa.example/api', { fetchFn: fetchFn as unknown as typeof fetch }),
    })
    const extended = client.extend(() => ({ hello: () => 'world' }))
    expect(extended.hello()).toBe('world')
  })
})

describe('createBridgeClient bound actions', () => {
  it('exposes getFlags, getQuotes, createOrder, getOrder, getOrderAudit, waitForOrder', () => {
    const fetchFn = vi.fn()
    const client = createBridgeClient({
      transport: httpBridge('https://wsa.example/api', { fetchFn: fetchFn as unknown as typeof fetch }),
    })
    expect(typeof client.getFlags).toBe('function')
    expect(typeof client.getQuotes).toBe('function')
    expect(typeof client.createOrder).toBe('function')
    expect(typeof client.getOrder).toBe('function')
    expect(typeof client.getOrderAudit).toBe('function')
    expect(typeof client.waitForOrder).toBe('function')
  })
})
