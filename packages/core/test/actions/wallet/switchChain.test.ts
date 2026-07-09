import { describe, it, expect, vi } from 'vitest'
import { switchChain, switchNetwork } from '../../../src/actions/wallet/switchChain.js'

describe('switchChain', () => {
  it('calls client.request with switchNetwork method', async () => {
    const request = vi.fn().mockResolvedValue(undefined)
    const client = { request } as any

    await switchChain(client, { network: 'testnet' })
    expect(request).toHaveBeenCalledWith({
      method: 'switchNetwork',
      params: { network: 'testnet' },
    })
  })

  it('returns void', async () => {
    const request = vi.fn().mockResolvedValue(undefined)
    const client = { request } as any

    const result = await switchChain(client, { network: 'mainnet' })
    expect(result).toBeUndefined()
  })

  it('switchNetwork alias exports the same function', () => {
    expect(switchNetwork).toBe(switchChain)
  })

  it('local account: re-targets the record provider when it supports switchNetwork', async () => {
    const provingSwitch = vi.fn().mockResolvedValue(undefined)
    const providerSwitch = vi.fn().mockResolvedValue(undefined)
    const client = {
      account: { type: 'local' },
      proving: { switchNetwork: provingSwitch },
      recordProvider: { setAccount: vi.fn(), requestRecords: vi.fn(), switchNetwork: providerSwitch },
      transport: { config: { network: 'testnet' } },
      request: vi.fn(),
    } as any

    await switchChain(client, { network: 'mainnet' })

    expect(provingSwitch).toHaveBeenCalledWith('mainnet')
    expect(providerSwitch).toHaveBeenCalledWith('mainnet')
    expect(client.transport.config.network).toBe('mainnet')
    expect(client.request).not.toHaveBeenCalled()
  })

  it('local account: a provider without switchNetwork is left untouched', async () => {
    const client = {
      account: { type: 'local' },
      proving: { switchNetwork: vi.fn().mockResolvedValue(undefined) },
      recordProvider: { setAccount: vi.fn(), requestRecords: vi.fn() },
      transport: { config: { network: 'testnet' } },
      request: vi.fn(),
    } as any

    await expect(switchChain(client, { network: 'mainnet' })).resolves.toBeUndefined()
    expect(client.transport.config.network).toBe('mainnet')
  })
})
