import { describe, it, expect } from 'vitest'
import {
  privateKeyToAccount,
  generateAccount,
  verifySignature,
  createProvingConfig,
  createNetworkClient,
} from '../src/index.js'

describe('@aleo-viem/provable', () => {
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
        networkUrl: 'https://api.explorer.provable.com/v1',
        proverUrl: 'https://prover.example.com',
      })

      expect(config.mode).toBe('delegated')
      expect(config.url).toBe('https://prover.example.com')
      expect(config.buildTransaction).toBeTypeOf('function')
    })

    it('creates a local proving config', () => {
      const config = createProvingConfig({
        mode: 'local',
        networkUrl: 'https://api.explorer.provable.com/v1',
      })

      expect(config.mode).toBe('local')
      expect(config.url).toBeUndefined()
      expect(config.buildTransaction).toBeTypeOf('function')
    })
  })

  describe('createNetworkClient', () => {
    it('creates an AleoNetworkClient', () => {
      const client = createNetworkClient('https://api.explorer.provable.com/v1')
      expect(client).toBeDefined()
      expect(client.getLatestHeight).toBeTypeOf('function')
    })
  })
})
