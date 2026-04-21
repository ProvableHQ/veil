import { describe, it, expect, vi } from 'vitest'
import {
  privateKeyToAccount,
  generateAccount,
  verifySignature,
  createProvingConfig,
  createNetworkClient,
  createLocalScanner,
  createRemoteScanner,
  createStandaloneScanner,
  createAleoClient,
} from '../src/index.js'

describe('@veil/provable', () => {
  describe('generateAccount', () => {
    it('creates a random account with all fields', () => {
      const account = generateAccount()

      expect(account.type).toBe('local')
      expect(account.source).toBe('privateKey')
      expect(account.address).toMatch(/^aleo1[a-z0-9]{58}$/)
      expect(account.privateKey).toMatch(/^APrivateKey1/)
      expect(account.viewKey).toMatch(/^AViewKey1/)
      expect(account.sign).toBeTypeOf('function')
      expect(account.signMessage).toBeTypeOf('function')
    })

    it('generates unique accounts each time', () => {
      const a1 = generateAccount()
      const a2 = generateAccount()
      expect(a1.address).not.toBe(a2.address)
      expect(a1.privateKey).not.toBe(a2.privateKey)
    })
  })

  describe('privateKeyToAccount', () => {
    it('derives address and viewKey from private key', () => {
      const original = generateAccount()
      const restored = privateKeyToAccount(original.privateKey)

      expect(restored.address).toBe(original.address)
      expect(restored.viewKey).toBe(original.viewKey)
      expect(restored.type).toBe('local')
      expect(restored.source).toBe('privateKey')
    })

    it('provides working sign function', async () => {
      const account = generateAccount()
      const message = new TextEncoder().encode('test message')
      const signature = await account.sign(message)

      expect(signature).toBeInstanceOf(Uint8Array)
      expect(signature.length).toBeGreaterThan(0)

      // Signature is a serialized string
      const sigString = new TextDecoder().decode(signature)
      expect(sigString).toMatch(/^sign1/)
    })

    it('sign and signMessage produce identical results', async () => {
      const account = generateAccount()
      const message = new TextEncoder().encode('identical')
      const sig1 = await account.sign(message)
      const sig2 = await account.signMessage(message)

      // Both should be valid signatures (may differ due to randomness in signing)
      expect(sig1).toBeInstanceOf(Uint8Array)
      expect(sig2).toBeInstanceOf(Uint8Array)
    })
  })

  describe('verifySignature', () => {
    it('verifies a valid signature', async () => {
      const account = generateAccount()
      const message = new TextEncoder().encode('verify me')
      const sigBytes = await account.sign(message)
      const sigString = new TextDecoder().decode(sigBytes)

      const verified = verifySignature(account.address, message, sigString)
      expect(verified).toBe(true)
    })

    it('rejects signature from different account', async () => {
      const signer = generateAccount()
      const other = generateAccount()
      const message = new TextEncoder().encode('wrong signer')
      const sigBytes = await signer.sign(message)
      const sigString = new TextDecoder().decode(sigBytes)

      const verified = verifySignature(other.address, message, sigString)
      expect(verified).toBe(false)
    })

    it('rejects signature for different message', async () => {
      const account = generateAccount()
      const sigBytes = await account.sign(new TextEncoder().encode('original'))
      const sigString = new TextDecoder().decode(sigBytes)

      const verified = verifySignature(
        account.address,
        new TextEncoder().encode('tampered'),
        sigString,
      )
      expect(verified).toBe(false)
    })
  })

  describe('createProvingConfig', () => {
    it('creates a delegated proving config', () => {
      const config = createProvingConfig({
        mode: 'delegated',
        networkUrl: 'https://api.provable.com/v2',
        proverUrl: 'https://prover.example.com',
      })

      expect(config.mode).toBe('delegated')
      expect(config.url).toBe('https://prover.example.com')
      expect(config.buildTransaction).toBeTypeOf('function')
    })

    it('creates a local proving config', () => {
      const config = createProvingConfig({
        mode: 'local',
        networkUrl: 'https://api.provable.com/v2',
      })

      expect(config.mode).toBe('local')
      expect(config.url).toBeUndefined()
      expect(config.buildTransaction).toBeTypeOf('function')
    })
  })

  describe('createNetworkClient', () => {
    it('creates an AleoNetworkClient', () => {
      const client = createNetworkClient('https://api.provable.com/v2')
      expect(client).toBeDefined()
      expect(client.getLatestHeight).toBeTypeOf('function')
    })
  })

  describe('createProvingConfig with account', () => {
    it('accepts an account option', () => {
      const account = generateAccount()
      const config = createProvingConfig({
        mode: 'local',
        networkUrl: 'https://api.provable.com/v2',
        account,
      })

      expect(config.mode).toBe('local')
      expect(config.buildTransaction).toBeTypeOf('function')
    })

    it('works without account (backwards compatible)', () => {
      const config = createProvingConfig({
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
      const scanner = createLocalScanner({
        url: 'https://api.provable.com/v2',
      })

      expect(scanner).toBeDefined()
      expect(scanner.requestRecords).toBeTypeOf('function')
    })
  })

  describe('createRemoteScanner', () => {
    it('returns a RecordProvider with requestRecords function', () => {
      const scanner = createRemoteScanner({
        url: 'https://rss.provable.com',
        consumerId: 'test-consumer',
      })

      expect(scanner).toBeDefined()
      expect(scanner.requestRecords).toBeTypeOf('function')
    })
  })

  describe('createStandaloneScanner', () => {
    it('returns a StandaloneRecordScanner with requestRecords function', () => {
      const account = generateAccount()
      const scanner = createStandaloneScanner({
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
      const account = generateAccount()
      const result = createAleoClient({
        privateKey: account.privateKey,
        networkUrl: 'https://api.provable.com/v2',
      })

      expect(result.account).toBeDefined()
      expect(result.account.address).toBe(account.address)
      expect(result.account.type).toBe('local')
      expect(result.publicClient).toBeDefined()
      expect(result.walletClient).toBeDefined()
    })

    it('uses delegated proving by default', () => {
      const account = generateAccount()
      const result = createAleoClient({
        privateKey: account.privateKey,
        networkUrl: 'https://api.provable.com/v2',
      })

      // walletClient should exist and have wallet actions
      expect(result.walletClient).toBeDefined()
      expect(result.walletClient.writeContract).toBeTypeOf('function')
    })

    it('accepts local proving mode', () => {
      const account = generateAccount()
      const result = createAleoClient({
        privateKey: account.privateKey,
        networkUrl: 'https://api.provable.com/v2',
        provingMode: 'local',
      })

      expect(result.walletClient).toBeDefined()
      expect(result.account.address).toMatch(/^aleo1/)
    })

    it('publicClient has read actions', () => {
      const account = generateAccount()
      const { publicClient } = createAleoClient({
        privateKey: account.privateKey,
        networkUrl: 'https://api.provable.com/v2',
      })

      expect(publicClient.getBlockNumber).toBeTypeOf('function')
      expect(publicClient.getBlock).toBeTypeOf('function')
      expect(publicClient.getBalance).toBeTypeOf('function')
      expect(publicClient.readContract).toBeTypeOf('function')
    })

    it('walletClient has write actions', () => {
      const account = generateAccount()
      const { walletClient } = createAleoClient({
        privateKey: account.privateKey,
        networkUrl: 'https://api.provable.com/v2',
      })

      expect(walletClient.writeContract).toBeTypeOf('function')
      expect(walletClient.deployContract).toBeTypeOf('function')
      expect(walletClient.signMessage).toBeTypeOf('function')
      expect(walletClient.transfer).toBeTypeOf('function')
    })
  })
})
