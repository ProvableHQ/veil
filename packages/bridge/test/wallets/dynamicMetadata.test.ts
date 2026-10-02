import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadDynamicWalletMetadata } from '../../examples/remote-wallets/dynamic-metadata.js'

const evmAddress = `0x${'12'.repeat(20)}`
const solanaAddress = 'So11111111111111111111111111111111111111112'
const identity = { walletId: 'wallet-one', chainName: 'EVM', accountAddress: evmAddress, thresholdSignatureScheme: 'TWO_OF_TWO', derivationPath: '[44,60,0,0,0]' }
const backup = { passwordEncrypted: true, fixture: 'backup-pointer' }
const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function setup(cached: unknown = { ...identity, externalServerKeySharesBackupInfo: backup }) {
  const directory = await mkdtemp(join(tmpdir(), 'dynamic-metadata-'))
  directories.push(directory)
  await mkdir(join(directory, 'environment'), { recursive: true })
  await writeFile(join(directory, 'environment', `evm-${evmAddress.toLowerCase()}.json`), JSON.stringify(cached))
  const getWalletByAddress = vi.fn().mockResolvedValue({ ...identity, externalServerKeyShares: [] })
  return { directory, getWalletByAddress, params: { client: { getWalletByAddress }, chain: 'evm' as const, address: evmAddress, environmentId: 'environment', cacheDirectory: directory } }
}

describe('Dynamic address-based example metadata', () => {
  it('fetches identity and restores backup pointers from the automatic address cache', async () => {
    const f = await setup()
    await expect(loadDynamicWalletMetadata(f.params)).resolves.toMatchObject({ ...identity, externalServerKeySharesBackupInfo: backup })
    expect(f.getWalletByAddress).toHaveBeenCalledWith(evmAddress)
  })
  it('accepts complete provider metadata without reading a cache', async () => {
    const f = await setup()
    f.getWalletByAddress.mockResolvedValue({ ...identity, externalServerKeySharesBackupInfo: backup })
    await expect(loadDynamicWalletMetadata({ ...f.params, cacheDirectory: '/nonexistent' })).resolves.toMatchObject({ externalServerKeySharesBackupInfo: backup })
  })
  it.each(['walletId', 'chainName', 'accountAddress', 'thresholdSignatureScheme', 'derivationPath'])('rejects mismatched cached %s', async field => {
    const f = await setup({ ...identity, [field]: 'different', externalServerKeySharesBackupInfo: backup })
    await expect(loadDynamicWalletMetadata(f.params)).rejects.toThrow(/match|address/i)
  })
  it('fails clearly when identity-only lookup has no saved backup metadata', async () => {
    const f = await setup()
    await expect(loadDynamicWalletMetadata({ ...f.params, cacheDirectory: '/nonexistent' })).rejects.toThrow(/creation|backup/i)
  })
  it('rejects a missing provider wallet even when a cache exists', async () => {
    const f = await setup()
    f.getWalletByAddress.mockResolvedValue(null)
    await expect(loadDynamicWalletMetadata(f.params)).rejects.toThrow(/not found/i)
  })
  it('rejects a different provider wallet address', async () => {
    const f = await setup()
    f.getWalletByAddress.mockResolvedValue({ ...identity, accountAddress: '0x0000000000000000000000000000000000000001' })
    await expect(loadDynamicWalletMetadata(f.params)).rejects.toThrow(/match/i)
  })
  it('does not treat differently cased Solana addresses as the same wallet', async () => {
    const f = await setup()
    f.getWalletByAddress.mockResolvedValue({ ...identity, chainName: 'SVM', accountAddress: 's' + solanaAddress.slice(1), externalServerKeySharesBackupInfo: backup })
    await expect(loadDynamicWalletMetadata({ ...f.params, chain: 'solana', address: solanaAddress })).rejects.toThrow(/match/i)
  })
  it('restores a provider-lowercased SOL address only from matching creation metadata', async () => {
    const f = await setup()
    const cached = { ...identity, chainName: 'SVM', accountAddress: solanaAddress, externalServerKeySharesBackupInfo: backup }
    await writeFile(join(f.directory, 'environment', `solana-${solanaAddress}.json`), JSON.stringify(cached))
    f.getWalletByAddress.mockResolvedValue({ ...identity, chainName: 'SOL', accountAddress: solanaAddress.toLowerCase() })
    await expect(loadDynamicWalletMetadata({ ...f.params, chain: 'solana', address: solanaAddress })).resolves.toMatchObject({ chainName: 'SVM', accountAddress: solanaAddress, walletId: identity.walletId })
    f.getWalletByAddress.mockResolvedValue({ ...identity, walletId: 'different-wallet', chainName: 'SOL', accountAddress: solanaAddress.toLowerCase() })
    await expect(loadDynamicWalletMetadata({ ...f.params, chain: 'solana', address: solanaAddress })).rejects.toThrow(/match/i)
  })
  it('rejects a lowercased SOL lookup without trusted creation metadata', async () => {
    const f = await setup()
    f.getWalletByAddress.mockResolvedValue({ ...identity, chainName: 'SOL', accountAddress: solanaAddress.toLowerCase(), externalServerKeySharesBackupInfo: backup })
    await expect(loadDynamicWalletMetadata({ ...f.params, chain: 'solana', address: solanaAddress })).rejects.toThrow(/creation/i)
  })
  it('rejects environment paths before any provider request', async () => {
    const f = await setup()
    await expect(loadDynamicWalletMetadata({ ...f.params, environmentId: '../escape' })).rejects.toThrow(/environment/i)
    expect(f.getWalletByAddress).not.toHaveBeenCalled()
  })
})
