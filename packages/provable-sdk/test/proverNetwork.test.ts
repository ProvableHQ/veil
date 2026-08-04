import { beforeAll, describe, it, expect } from 'vitest'
import { loadNetwork, DEFAULT_PROVER_URL, type AleoSdk } from '../src/index.js'

/**
 * `proverUrl` is a base URL and the network segment is appended, mirroring the
 * record scanner. That is what lets a client re-target proving across
 * `switchChain` instead of staying on the network it started from.
 *
 * Local and no network access — `createProvingConfig` is pure until a build or
 * execute call, and `switchNetwork` only swaps the cached binary set.
 */
describe('prover endpoint derivation', () => {
  let aleo: AleoSdk

  beforeAll(async () => {
    aleo = await loadNetwork('testnet')
  }, 60_000)

  const config = (proverUrl: string) =>
    aleo.createProvingConfig({
      mode: 'delegated',
      networkUrl: 'https://api.provable.com/v2',
      proverUrl,
    })

  it('appends the active network to a base URL', () => {
    expect(config('https://api.provable.com/prove').url).toBe(
      'https://api.provable.com/prove/testnet',
    )
  })

  it('re-targets the endpoint when the network changes', async () => {
    const proving = config('https://api.provable.com/prove')
    expect(proving.url).toBe('https://api.provable.com/prove/testnet')

    await proving.switchNetwork?.('mainnet')

    // Staying on /testnet here would submit proving requests to the chain the
    // client just left, which is the bug this guards.
    expect(proving.url).toBe('https://api.provable.com/prove/mainnet')

    await proving.switchNetwork?.('testnet')
    expect(proving.url).toBe('https://api.provable.com/prove/testnet')
  })

  it('keeps each config on its own network, so one switch does not move another', async () => {
    const a = config('https://api.provable.com/prove')
    const b = config('https://api.provable.com/prove')

    await a.switchNetwork?.('mainnet')

    expect(a.url).toBe('https://api.provable.com/prove/mainnet')
    expect(b.url).toBe('https://api.provable.com/prove/testnet')
  })

  it('re-targets a fully-qualified URL rather than doubling the segment', () => {
    // Tolerated so a caller carrying the old form still switches correctly.
    expect(config('https://api.provable.com/prove/testnet').url).toBe(
      'https://api.provable.com/prove/testnet',
    )
    expect(config('https://api.provable.com/prove/mainnet').url).toBe(
      'https://api.provable.com/prove/testnet',
    )
  })

  it('ignores trailing slashes on the base', () => {
    expect(config('https://api.provable.com/prove/').url).toBe(
      'https://api.provable.com/prove/testnet',
    )
  })

  it('appends to a self-hosted base', () => {
    expect(config('https://prover.internal.example').url).toBe(
      'https://prover.internal.example/testnet',
    )
  })

  it('leaves url undefined when no prover is configured', () => {
    const proving = aleo.createProvingConfig({
      mode: 'local',
      networkUrl: 'https://api.provable.com/v2',
    })
    expect(proving.url).toBeUndefined()
  })

  describe('the default endpoint', () => {
    it('defaults to the hosted prover under delegated mode', () => {
      const proving = aleo.createProvingConfig({
        mode: 'delegated',
        networkUrl: 'https://api.provable.com/v2',
      })
      // provingMode defaults to delegated, so without this a client built with
      // no proverUrl would construct fine and fail on its first write.
      expect(proving.url).toBe(`${DEFAULT_PROVER_URL}/testnet`)
    })

    it('re-targets the default across a switch, like an explicit base', async () => {
      const proving = aleo.createProvingConfig({
        mode: 'delegated',
        networkUrl: 'https://api.provable.com/v2',
      })
      await proving.switchNetwork?.('mainnet')
      expect(proving.url).toBe(`${DEFAULT_PROVER_URL}/mainnet`)
    })

    it('does not default under local mode, which reaches no prover', () => {
      const proving = aleo.createProvingConfig({
        mode: 'local',
        networkUrl: 'https://api.provable.com/v2',
      })
      expect(proving.url).toBeUndefined()
    })

    it('prefers an explicit base over the default', () => {
      const proving = aleo.createProvingConfig({
        mode: 'delegated',
        networkUrl: 'https://api.provable.com/v2',
        proverUrl: 'https://prover.internal.example',
      })
      expect(proving.url).toBe('https://prover.internal.example/testnet')
    })

    it('reaches a delegated client built with no prover configured', () => {
      const { walletClient } = aleo.createAleoClient({
        privateKey: aleo.generateAccount().privateKey,
        networkUrl: 'https://api.provable.com/v2',
      })
      expect(walletClient.proving.mode).toBe('delegated')
      expect(walletClient.proving.url).toBe(`${DEFAULT_PROVER_URL}/testnet`)
    }, 30_000)
  })
})
