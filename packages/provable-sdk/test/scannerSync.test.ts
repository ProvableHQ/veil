import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as sdk from '@provablehq/sdk/testnet.js'
import { loadNetwork, type AleoSdk } from '../src/index.js'

describe('inventory scanner synchronization', () => {
  let aleo: AleoSdk
  beforeAll(async () => { aleo = await loadNetwork('testnet') }, 60_000)
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
  const setup = () => {
    const register = vi.spyOn(sdk.RecordScanner.prototype, 'registerEncrypted').mockResolvedValue({ ok: true, data: {} } as never)
    const status = vi.spyOn(sdk.RecordScanner.prototype, 'status').mockResolvedValue({ ok: true, data: { synced: true } } as never)
    const owned = vi.spyOn(sdk.RecordScanner.prototype, 'owned').mockResolvedValue({ ok: true, data: [] } as never)
    const scanner = aleo.createRemoteScanner({ waitForSync: true, syncTimeoutMs: 10, startBlock: 123 })
    scanner.setAccount!(aleo.generateAccount())
    return { scanner, register, status, owned }
  }
  it('recovers an invalidated registration before reading owned records', async () => {
    const { scanner, register, status, owned } = setup()
    status.mockResolvedValueOnce({ ok: false, status: 422 } as never)
    await expect(scanner.requestRecords({ program: 'credits.aleo' })).resolves.toEqual([])
    expect(register).toHaveBeenCalledTimes(2)
    expect(register).toHaveBeenLastCalledWith(expect.anything(), 123)
    expect(status).toHaveBeenCalledTimes(2)
    expect(owned).toHaveBeenCalledTimes(1)
  })
  it('does not present a partially synced scanner as complete inventory', async () => {
    const { scanner, status, owned } = setup()
    vi.useFakeTimers()
    status.mockResolvedValue({ ok: true, data: { synced: false } } as never)
    const result = expect(scanner.requestRecords({ program: 'credits.aleo' })).rejects.toThrow('synchronization timed out')
    await vi.runAllTimersAsync()
    await result
    expect(owned).not.toHaveBeenCalled()
  })
  it('bounds invalid-registration recovery and validates its deadline', async () => {
    const { scanner, status, register } = setup()
    status.mockResolvedValue({ ok: false, status: 422 } as never)
    await expect(scanner.requestRecords({ program: 'credits.aleo' })).rejects.toThrow('status failed')
    expect(register).toHaveBeenCalledTimes(2)
    expect(() => aleo.createRemoteScanner({ syncTimeoutMs: 0 })).toThrow('syncTimeoutMs')
  })
})
