import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer } from 'node:net'
import { GraphKey, ViewKey, RecordPlaintext, Field } from '@provablehq/sdk/testnet.js'
import { startDevnode, type DevnodeInstance } from '@provablehq/veil-aleo-devnode'
import { createDevnodeClient } from '../../src/index.js'
import { createWalletClient, createTestClient, http, memoryRecordInventoryStore, parseRecord, waitForConfirmation, type OwnedRecord, type WalletClient } from '@provablehq/veil-core'

const RUN = process.env.VEIL_DEVNODE_INTEGRATION === '1'

// Uses an isolated local ledger and its seeded account. The provider deliberately
// keeps stale records so reservation checks must prevent their reuse after fees.
describe.runIf(RUN)('devnode: managed private fees', () => {
  let node: DevnodeInstance | undefined
  let client: WalletClient
  const records: OwnedRecord[] = []
  const store = memoryRecordInventoryStore()
  let scope: string
  let firstFee: string

  beforeAll(async () => {
    // Allocate an unused port instead of interrupting another local devnode.
    const server = createServer()
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    const socketAddr = `127.0.0.1:${port}`
    node = await startDevnode({ socketAddr, readyTimeout: 45_000 })
    const initial = createDevnodeClient({ socketAddr })
    const transport = http(`http://${socketAddr}`, { network: 'testnet' })
    await createTestClient({ transport }).advanceBlock({ count: 1 })
    const graphKey = GraphKey.from_view_key(ViewKey.from_string(initial.account.viewKey))
    // Create five distinct credits records with public fees before enabling
    // coordination. Every later fee must come from this discovered set.
    for (let i = 0; i < 5; i++) {
      const result = await initial.walletClient.executeContract({ program: 'credits.aleo', function: 'transfer_public_to_private',
        inputs: [initial.account.address, '2000000u64'] })
      const tx = await initial.publicClient.getTransaction({ id: result.transactionId })
      const commitment = tx.execution!.transitions.at(-1)!.outputs!.find(output => output.type === 'record')!.id
      const plaintext = result.outputs.find(output => output.startsWith('{'))!
      records.push({ programName: 'credits.aleo', recordName: 'credits', recordPlaintext: plaintext,
        commitment, tag: RecordPlaintext.fromString(plaintext).tag(graphKey, Field.fromString(commitment)).toString(), spent: false })
    }
    const proving = initial.walletClient.proving
    if (!proving) throw new Error('Devnode client did not install its prover')
    client = createWalletClient({ account: initial.account, transport, proving,
      recordProvider: { requestRecords: async () => records, setAccount() {} },
      recordManagement: { enabled: true, store, chainId: 'private-fee-e2e', maxFeeMicrocredits: 1_000_000n } })
    scope = JSON.stringify(['private-fee-e2e', initial.account.address])
  }, 180_000)
  afterAll(async () => { await node?.stop() }, 30_000)

  it('executes a private transfer with a separate reserved fee record', async () => {
    const result = await client.executeContract({ program: 'credits.aleo', function: 'transfer_private',
      inputs: [records[0]!.recordPlaintext, client.account!.address, '100u64'], privateFee: true, feeRecord: records[0]!.recordPlaintext })
    const [entry] = await store.list(scope)
    firstFee = entry!.feeRecordId!
    expect(entry!.status).toBe('confirmed')
    expect(firstFee).not.toBe(parseRecord(records[0]!.recordPlaintext).nonce)
    expect(entry!.records).toHaveLength(2)
    expect(BigInt(entry!.feeMicrocredits!)).toBeGreaterThan(0n)
    const tx = await client.request({ method: 'getTransaction', params: { id: result.transactionId } }) as any
    expect(tx.fee.transition.function).toBe('fee_private')
    const selected = records.find(record => parseRecord(record.recordPlaintext).nonce === firstFee)!
    expect(tx.fee.transition.inputs[0].tag).toBe(selected.tag)
  }, 120_000)

  it('replaces a supplied fee record that the previous transaction consumed', async () => {
    const prior = records.find(record => parseRecord(record.recordPlaintext).nonce === firstFee)!
    const id = await client.writeContract({ program: 'credits.aleo', function: 'transfer_public',
      inputs: [client.account!.address, '1u64'], privateFee: true, feeRecord: prior.recordPlaintext })
    await waitForConfirmation(client, id)
    await client.reconcileRecordInventory()
    const entries = await store.list(scope)
    expect(entries[1]!.status).toBe('confirmed')
    expect(entries[1]!.feeRecordId).not.toBe(firstFee)
    expect(entries[1]!.records).toEqual([entries[1]!.feeRecordId])
  }, 120_000)

  it('retains a private fee consumed by an execution rejected on chain', async () => {
    // The seeded public balance cannot cover this transfer. Its finalize fails,
    // but the separately authorized private fee is still charged by the ledger.
    const id = await client.writeContract({ program: 'credits.aleo', function: 'transfer_public',
      inputs: [client.account!.address, '18446744073709551615u64'], privateFee: true })
    await expect(waitForConfirmation(client, id)).rejects.toThrow()
    await client.reconcileRecordInventory()
    const entry = (await store.list(scope)).at(-1)!
    expect(entry.status).toBe('rejected')
    const inventory = await client.getRecordInventory({ asset: { program: 'credits.aleo' } })
    expect(inventory.reserved.some(record => record.id === entry.feeRecordId)).toBe(true)
  }, 120_000)

  it('fails before submission when every remaining credits record is reserved', async () => {
    const available = await client.getRecordInventory({ asset: { program: 'credits.aleo' } })
    expect(available.available).toHaveLength(1)
    await store.acquire({ scope, records: available.available.map(record => record.id), program: 'credits.aleo', function: 'join',
      status: 'prepared', accountType: 'local', createdAt: Date.now() })
    const count = (await store.list(scope)).length
    await expect(client.writeContract({ program: 'credits.aleo', function: 'transfer_public',
      inputs: [client.account!.address, '1u64'], privateFee: true })).rejects.toThrow('No available credits record')
    expect(await store.list(scope)).toHaveLength(count)
  }, 60_000)
})
