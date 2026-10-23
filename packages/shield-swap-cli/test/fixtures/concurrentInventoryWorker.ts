import { createWalletClient, parseRecord } from '@provablehq/veil-core'
import { sqliteRecordInventoryStore } from '../../src/storage.js'
import { executeWithTokenRecord } from '../../../shield-swap/src/actions/swap/internal.js'

// Each worker scans the same two records. The parent releases both first
// acquisitions together, forcing contention across actual SQLite processes.
const store = await sqliteRecordInventoryStore(process.argv[2]!)
const attempts: string[][] = []
const acquire = store.acquire
store.acquire = async entry => {
  attempts.push(entry.records)
  if (attempts.length === 1) {
    const proceed = new Promise<void>(resolve => process.once('message', () => resolve()))
    process.send!({ ready: true })
    await proceed
  }
  return acquire(entry)
}
const request = async () => { throw new Error('Unexpected network call') }
const client = createWalletClient({
  account: { type: 'local', source: 'test', address: 'aleo1owner', privateKey: 'test', viewKey: 'test', sign: async () => '', signMessage: async () => '' },
  transport: { config: { key: 'test', name: 'test', type: 'custom', network: 'testnet', request }, request },
  recordManagement: { enabled: true, store },
  recordProvider: { requestRecords: async () => [1, 2].map(nonce => ({ programName: 'token.aleo', recordName: 'Token', spent: false,
    recordPlaintext: `{ owner: aleo1owner.private, amount: 100u128.private, _nonce: ${nonce}group.public }` })), setAccount() {} },
  proving: { mode: 'local', execute: async options => {
    const transactionId = `at1${process.pid}`
    await options.onProgress?.({ type: 'transaction-confirmed', transactionId })
    return { transactionId, transitions: [], outputs: [parseRecord(options.inputs[0]!).nonce] }
  } },
})
try {
  const result = await executeWithTokenRecord(client, { tokenInProgram: 'token.aleo', tokenId: '1field', minAmount: 10n },
    record => client.executeContract({ program: 'token.aleo', function: 'spend', inputs: [record] }))
  process.send!({ nonce: result.outputs[0], attempts })
} finally {
  store.close()
  process.disconnect()
}
