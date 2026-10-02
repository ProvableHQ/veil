import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DynamicEvmWalletClient } from '@dynamic-labs-wallet/node-evm'
import type { DynamicEvmClientConfig } from '@provablehq/aleo-bridge-sdk/dynamic'
import { getAddress } from 'viem'

type WalletMetadata = DynamicEvmClientConfig['walletMetadata']

/**
 * Configures address lookup and the recovery metadata retained at wallet creation.
 * @property client Authenticated Dynamic client for the selected chain.
 * @property chain Selects EVM address normalization or case-sensitive Solana matching.
 * @property address Existing wallet address to resolve through Dynamic.
 * @property environmentId Dynamic environment whose identity and cache are used.
 * @property cacheDirectory Optional cache root. Defaults to ~/.config/veil/dynamic; each environment has a separate subdirectory.
 * @property metadataFile Optional explicit file containing full creation metadata. Defaults to the address-derived cache path; supports existing deployments.
 * @example const options: DynamicMetadataOptions = { client: dynamicEvm, chain: 'evm', address, environmentId }
 */
export type DynamicMetadataOptions = {
  client: Pick<DynamicEvmWalletClient, 'getWalletByAddress'>
  chain: 'evm' | 'solana'
  address: string
  environmentId: string
  cacheDirectory?: string
  metadataFile?: string
}

function normalizedAddress(value: string, chain: DynamicMetadataOptions['chain']): string {
  if (typeof value !== 'string') throw new Error('Dynamic wallet address is missing')
  if (chain === 'evm') return getAddress(value)
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) throw new Error('Dynamic Solana address is invalid')
  return value
}

/**
 * Resolves a Dynamic wallet by address and restores required backup pointers.
 * Contacts Dynamic for identity, then reads cached creation metadata when the
 * response omits backup pointers or changes Solana address casing. Does not create wallets, recover shares,
 * sign messages, or submit transactions.
 * @param options Wallet identity and optional location of persisted creation metadata.
 * @returns Metadata matching the requested address, chain, wallet ID, and derivation settings.
 * @throws When Dynamic cannot find the wallet, returns a different identity, or backup metadata is missing or mismatched.
 * @example
 * const metadata = await loadDynamicWalletMetadata({ client: dynamicEvm, chain: 'evm', address, environmentId })
 */
export async function loadDynamicWalletMetadata(options: DynamicMetadataOptions): Promise<WalletMetadata> {
  if (!/^[a-zA-Z0-9-]+$/.test(options.environmentId)) throw new Error('Dynamic environment ID is invalid')
  const address = normalizedAddress(options.address, options.chain)
  const chainName = options.chain === 'evm' ? 'EVM' : 'SVM'
  const found = await options.client.getWalletByAddress(address)
  if (!found) throw new Error(`Dynamic wallet not found: ${address}`)
  // The live byAddress API can return the SOL chain alias and lowercase the
  // Solana address. Only creation metadata with the same wallet ID can restore
  // that identity; a case-folded Solana address is never trusted on its own.
  const solanaAlias = options.chain === 'solana' && found.chainName === 'SOL'
  const lowercasedSolanaLookup = solanaAlias && found.accountAddress !== address
    && found.accountAddress === address.toLowerCase()
  if ((found.chainName !== chainName && !solanaAlias)
    || (!lowercasedSolanaLookup && normalizedAddress(found.accountAddress, options.chain) !== address)) {
    throw new Error('Dynamic lookup does not match the requested wallet address and chain')
  }
  // The provider lookup can return transient shares; never copy those into
  // the metadata object passed to an application or persisted by its caller.
  const { externalServerKeyShares: _shares, ...identity } = found
  if (identity.externalServerKeySharesBackupInfo && !lowercasedSolanaLookup) return { ...identity, chainName, accountAddress: address }

  const cacheAddress = options.chain === 'evm' ? address.toLowerCase() : address
  const path = options.metadataFile ?? join(
    options.cacheDirectory ?? join(homedir(), '.config', 'veil', 'dynamic'),
    options.environmentId,
    `${options.chain}-${cacheAddress}.json`,
  )
  let cached: WalletMetadata
  try {
    cached = JSON.parse(await readFile(path, 'utf8')) as WalletMetadata
  } catch {
    throw new Error(`Dynamic lookup requires saved creation metadata; save the full walletMetadata returned at creation to ${path}`)
  }
  if (!cached || cached.walletId !== identity.walletId || cached.chainName !== chainName
    || normalizedAddress(cached.accountAddress, options.chain) !== address
    || cached.thresholdSignatureScheme !== identity.thresholdSignatureScheme
    || cached.derivationPath !== identity.derivationPath) {
    throw new Error('Cached Dynamic metadata does not match the provider wallet identity')
  }
  if (!cached.externalServerKeySharesBackupInfo) throw new Error('Cached Dynamic creation metadata is missing backup pointers')
  // Preserve creation-only share-set identifiers and backup state. Identity
  // fields were compared above, so a stale cache cannot silently switch wallets.
  return { ...cached, ...identity, chainName, accountAddress: address, externalServerKeySharesBackupInfo: cached.externalServerKeySharesBackupInfo }
}
