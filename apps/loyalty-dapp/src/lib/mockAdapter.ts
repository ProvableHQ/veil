/**
 * Mock wallet adapter for development/demo mode.
 *
 * Simulates the full wallet flow without a real browser extension.
 * In production, you'd use LeoWalletAdapter, PuzzleWalletAdapter, etc.
 */
import type { AleoWalletAdapter } from '@veil/wallet-adapter'

const MOCK_ADDRESS = 'aleo1demo0000000000000000000000000000000000000000000000000cpv5yj'

let txCounter = 0

export function createMockAdapter(): AleoWalletAdapter & {
  connect(): Promise<void>
  disconnect(): Promise<void>
} {
  const adapter: AleoWalletAdapter & {
    connect(): Promise<void>
    disconnect(): Promise<void>
  } = {
    account: undefined,
    connected: false,

    async connect() {
      // Simulate connection delay
      await delay(500)
      this.account = { address: MOCK_ADDRESS }
      this.connected = true
    },

    async disconnect() {
      await delay(200)
      this.account = undefined
      this.connected = false
    },

    async signMessage(_message: Uint8Array) {
      await delay(300)
      return new Uint8Array(64) // Mock signature
    },

    async executeTransaction(options) {
      // Simulate proving + broadcast delay
      console.log('[Mock Wallet] Executing:', options.program, options.function, options.inputs)
      await delay(2000)
      txCounter++
      return { transactionId: `at1mock${txCounter.toString().padStart(58, '0')}` }
    },

    async executeDeployment(_deployment) {
      await delay(2000)
      txCounter++
      return { transactionId: `at1mockdeploy${txCounter.toString().padStart(51, '0')}` }
    },

    async transactionStatus(_transactionId) {
      await delay(300)
      return 'Finalized' as unknown as Awaited<ReturnType<AleoWalletAdapter['transactionStatus']>>
    },

    async decrypt(cipherText) {
      await delay(200)
      return `{ owner: ${MOCK_ADDRESS}, points: 500u64, card_id: 1u64 }`
    },

    async requestRecords(_program) {
      await delay(300)
      return []
    },

    async transitionViewKeys(_transactionId) {
      await delay(200)
      return []
    },
  }

  return adapter
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
