import { beforeAll, describe, it, expect } from 'vitest'
import { loadNetwork, type AleoSdk } from '../src/index.js'

describe('@veil/provable', () => {
  let aleo: AleoSdk

  beforeAll(async () => {
    aleo = await loadNetwork('testnet')
  })

  describe('loadNetwork', () => {
    it('returns a handle bound to the named network', async () => {
      expect(aleo.network).toBe('testnet')
    })

    it('memoizes the SDK module load', async () => {
      const a = await loadNetwork('testnet')
      const b = await loadNetwork('testnet')
      // Each call returns a fresh handle wrapping the same memoized SDK module.
      // Methods exist on both handles; calling them gives matching results.
      const acc1 = a.generateAccount()
      const acc2 = b.privateKeyToAccount(acc1.privateKey)
      expect(acc2.address).toBe(acc1.address)
    })
  })

  describe('generateAccount', () => {
    it('creates a random account with all fields', () => {
      const account = aleo.generateAccount()

      expect(account.type).toBe('local')
      expect(account.source).toBe('privateKey')
      expect(account.address).toMatch(/^aleo1[a-z0-9]{58}$/)
      expect(account.privateKey).toMatch(/^APrivateKey1/)
      expect(account.viewKey).toMatch(/^AViewKey1/)
      expect(account.sign).toBeTypeOf('function')
      expect(account.signMessage).toBeTypeOf('function')
    })

    it('generates unique accounts each time', () => {
      const a1 = aleo.generateAccount()
      const a2 = aleo.generateAccount()
      expect(a1.address).not.toBe(a2.address)
      expect(a1.privateKey).not.toBe(a2.privateKey)
    })
  })

  describe('privateKeyToAccount', () => {
    it('derives address and viewKey from private key', () => {
      const original = aleo.generateAccount()
      const restored = aleo.privateKeyToAccount(original.privateKey)

      expect(restored.address).toBe(original.address)
      expect(restored.viewKey).toBe(original.viewKey)
      expect(restored.type).toBe('local')
      expect(restored.source).toBe('privateKey')
    })

    it('provides working sign function', async () => {
      const account = aleo.generateAccount()
      const message = new TextEncoder().encode('test message')
      const signature = await account.sign(message)

      expect(signature).toBeInstanceOf(Uint8Array)
      expect(signature.length).toBeGreaterThan(0)

      const sigString = new TextDecoder().decode(signature)
      expect(sigString).toMatch(/^sign1/)
    })

    it('sign and signMessage produce identical results', async () => {
      const account = aleo.generateAccount()
      const message = new TextEncoder().encode('identical')
      const sig1 = await account.sign(message)
      const sig2 = await account.signMessage(message)

      expect(sig1).toBeInstanceOf(Uint8Array)
      expect(sig2).toBeInstanceOf(Uint8Array)
    })
  })

  describe('verifySignature', () => {
    it('verifies a valid signature', async () => {
      const account = aleo.generateAccount()
      const message = new TextEncoder().encode('verify me')
      const sigBytes = await account.sign(message)
      const sigString = new TextDecoder().decode(sigBytes)

      const verified = aleo.verifySignature(account.address, message, sigString)
      expect(verified).toBe(true)
    })

    it('rejects signature from different account', async () => {
      const signer = aleo.generateAccount()
      const other = aleo.generateAccount()
      const message = new TextEncoder().encode('wrong signer')
      const sigBytes = await signer.sign(message)
      const sigString = new TextDecoder().decode(sigBytes)

      const verified = aleo.verifySignature(other.address, message, sigString)
      expect(verified).toBe(false)
    })

    it('rejects signature for different message', async () => {
      const account = aleo.generateAccount()
      const sigBytes = await account.sign(new TextEncoder().encode('original'))
      const sigString = new TextDecoder().decode(sigBytes)

      const verified = aleo.verifySignature(
        account.address,
        new TextEncoder().encode('tampered'),
        sigString,
      )
      expect(verified).toBe(false)
    })
  })

  describe('createProvingConfig', () => {
    it('creates a delegated proving config', () => {
      const config = aleo.createProvingConfig({
        mode: 'delegated',
        networkUrl: 'https://api.provable.com/v2',
        proverUrl: 'https://prover.example.com',
      })

      expect(config.mode).toBe('delegated')
      expect(config.url).toBe('https://prover.example.com')
      expect(config.buildTransaction).toBeTypeOf('function')
    })

    it('creates a local proving config', () => {
      const config = aleo.createProvingConfig({
        mode: 'local',
        networkUrl: 'https://api.provable.com/v2',
      })

      expect(config.mode).toBe('local')
      expect(config.url).toBeUndefined()
      expect(config.buildTransaction).toBeTypeOf('function')
    })

    it('exposes switchNetwork for runtime SDK rebinding', () => {
      const config = aleo.createProvingConfig({
        mode: 'delegated',
        networkUrl: 'https://api.provable.com/v2',
      })

      expect(config.switchNetwork).toBeTypeOf('function')
    })

    it('switchNetwork rejects unsupported network names', async () => {
      const config = aleo.createProvingConfig({
        mode: 'delegated',
        networkUrl: 'https://api.provable.com/v2',
      })

      await expect(config.switchNetwork!('canary')).rejects.toThrow(/mainnet.*testnet/)
    })
  })

  describe('createNetworkClient', () => {
    it('creates an AleoNetworkClient', () => {
      const client = aleo.createNetworkClient('https://api.provable.com/v2')
      expect(client).toBeDefined()
      expect(client.getLatestHeight).toBeTypeOf('function')
    })
  })

  describe('createProvingConfig with account', () => {
    it('accepts an account option', () => {
      const account = aleo.generateAccount()
      const config = aleo.createProvingConfig({
        mode: 'local',
        networkUrl: 'https://api.provable.com/v2',
        account,
      })

      expect(config.mode).toBe('local')
      expect(config.buildTransaction).toBeTypeOf('function')
    })

    it('works without account', () => {
      const config = aleo.createProvingConfig({
        mode: 'delegated',
        networkUrl: 'https://api.provable.com/v2',
        proverUrl: 'https://prover.example.com',
      })

      expect(config.mode).toBe('delegated')
      expect(config.buildTransaction).toBeTypeOf('function')
    })
  })

  describe('createLocalScanner', () => {
    it('returns a RecordProvider with requestRecords function', () => {
      const scanner = aleo.createLocalScanner({
        url: 'https://api.provable.com/v2',
      })

      expect(scanner).toBeDefined()
      expect(scanner.requestRecords).toBeTypeOf('function')
    })
  })

  describe('createRemoteScanner', () => {
    it('returns a RecordProvider with requestRecords function', () => {
      const scanner = aleo.createRemoteScanner({
        url: 'https://rss.provable.com',
        consumerId: 'test-consumer',
      })

      expect(scanner).toBeDefined()
      expect(scanner.requestRecords).toBeTypeOf('function')
    })
  })

  describe('createStandaloneScanner', () => {
    it('returns a StandaloneRecordScanner with requestRecords function', () => {
      const account = aleo.generateAccount()
      const scanner = aleo.createStandaloneScanner({
        url: 'https://rss.provable.com',
        consumerId: 'test-consumer',
        viewKey: account.viewKey!,
      })

      expect(scanner).toBeDefined()
      expect(scanner.requestRecords).toBeTypeOf('function')
    })
  })

  describe('createAleoClient', () => {
    it('returns publicClient, walletClient, and account', () => {
      const account = aleo.generateAccount()
      const result = aleo.createAleoClient({
        privateKey: account.privateKey,
        networkUrl: 'https://api.provable.com/v2',
      })

      expect(result.account).toBeDefined()
      expect(result.account.address).toBe(account.address)
      expect(result.account.type).toBe('local')
      expect(result.publicClient).toBeDefined()
      expect(result.walletClient).toBeDefined()
    })

    it('binds the transport to the loaded network', () => {
      const account = aleo.generateAccount()
      const { publicClient } = aleo.createAleoClient({
        privateKey: account.privateKey,
        networkUrl: 'https://api.provable.com/v2',
      })

      expect(publicClient.transport.config.network).toBe('testnet')
    })

    it('uses delegated proving by default', () => {
      const account = aleo.generateAccount()
      const result = aleo.createAleoClient({
        privateKey: account.privateKey,
        networkUrl: 'https://api.provable.com/v2',
      })

      expect(result.walletClient).toBeDefined()
      expect(result.walletClient.writeContract).toBeTypeOf('function')
    })

    it('accepts local proving mode', () => {
      const account = aleo.generateAccount()
      const result = aleo.createAleoClient({
        privateKey: account.privateKey,
        networkUrl: 'https://api.provable.com/v2',
        provingMode: 'local',
      })

      expect(result.walletClient).toBeDefined()
      expect(result.account.address).toMatch(/^aleo1/)
    })

    it('publicClient has read actions', () => {
      const account = aleo.generateAccount()
      const { publicClient } = aleo.createAleoClient({
        privateKey: account.privateKey,
        networkUrl: 'https://api.provable.com/v2',
      })

      expect(publicClient.getBlockNumber).toBeTypeOf('function')
      expect(publicClient.getBlock).toBeTypeOf('function')
      expect(publicClient.getBalance).toBeTypeOf('function')
      expect(publicClient.readContract).toBeTypeOf('function')
    })

    it('walletClient has write actions', () => {
      const account = aleo.generateAccount()
      const { walletClient } = aleo.createAleoClient({
        privateKey: account.privateKey,
        networkUrl: 'https://api.provable.com/v2',
      })

      expect(walletClient.writeContract).toBeTypeOf('function')
      expect(walletClient.deployContract).toBeTypeOf('function')
      expect(walletClient.signMessage).toBeTypeOf('function')
      expect(walletClient.transfer).toBeTypeOf('function')
    })

    it('does not wire a recordProvider by default', () => {
      const account = aleo.generateAccount()
      const { walletClient } = aleo.createAleoClient({
        privateKey: account.privateKey,
        networkUrl: 'https://api.provable.com/v2',
      })

      expect(walletClient.recordProvider).toBeUndefined()
    })

    it('accepts a RecordProvider via records option', () => {
      const account = aleo.generateAccount()
      const scanner = aleo.createLocalScanner({ url: 'https://api.provable.com/v2' })
      const { walletClient } = aleo.createAleoClient({
        privateKey: account.privateKey,
        networkUrl: 'https://api.provable.com/v2',
        records: scanner,
      })

      expect(walletClient.recordProvider).toBe(scanner)
    })

    it('requestRecords throws without a configured records provider', async () => {
      const account = aleo.generateAccount()
      const { walletClient } = aleo.createAleoClient({
        privateKey: account.privateKey,
        networkUrl: 'https://api.provable.com/v2',
      })

      await expect(
        walletClient.requestRecords({ program: 'token.aleo' }),
      ).rejects.toThrow(/recordProvider/)
    })
  })
})
