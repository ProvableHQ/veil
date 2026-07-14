import { describe, it, expect } from 'vitest'
import { tryLoadSdk, loadSdk } from '../../src/utils/sdk.js'

describe('tryLoadSdk', () => {
  it('resolves the SDK module when the peer is installed (test env has it)', async () => {
    const sdk = await tryLoadSdk()
    expect(sdk).not.toBeNull()
    expect(sdk!.BHP256).toBeDefined()
  })

  it('resolves the same module loadSdk resolves', async () => {
    expect(await tryLoadSdk()).toBe(await loadSdk())
  })
})
