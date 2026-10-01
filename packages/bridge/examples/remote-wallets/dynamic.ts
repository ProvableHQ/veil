/** Authenticates Dynamic server clients and prints existing wallet addresses without signing or submitting. */
import { readFile } from 'node:fs/promises'
import { DynamicEvmWalletClient } from '@dynamic-labs-wallet/node-evm'
import { DynamicSvmWalletClient } from '@dynamic-labs-wallet/node-svm'
import { createBridgeClient, evmHttp, solanaHttp } from '@provablehq/aleo-bridge-sdk'
import {
  createDynamicEvmClient, createDynamicSolanaClient,
  type DynamicEvmClientConfig, type DynamicSolanaClientConfig,
} from '@provablehq/aleo-bridge-sdk/dynamic'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Set ${name} before running this example`)
  return value
}

// These JSON files hold the complete metadata returned by wallet creation/import.
// Production services can load metadata from their own database instead.
const evmMetadata: DynamicEvmClientConfig['walletMetadata'] = JSON.parse(
  await readFile(required('DYNAMIC_EVM_METADATA_FILE'), 'utf8'),
)
const solanaMetadata: DynamicSolanaClientConfig['walletMetadata'] = JSON.parse(
  await readFile(required('DYNAMIC_SOLANA_METADATA_FILE'), 'utf8'),
)
const environmentId = required('DYNAMIC_ENVIRONMENT_ID')
const apiToken = required('DYNAMIC_API_TOKEN')
const dynamicEvm = new DynamicEvmWalletClient({ environmentId })
const dynamicSolana = new DynamicSvmWalletClient({ environmentId })
await dynamicEvm.authenticateApiToken(apiToken)
await dynamicSolana.authenticateApiToken(apiToken)

// This example assumes encrypted shares were backed up to Dynamic when the wallets were created.
const ethereum = await createDynamicEvmClient({
  client: dynamicEvm,
  walletMetadata: evmMetadata,
  password: required('DYNAMIC_EVM_WALLET_PASSWORD'),
  transport: evmHttp(process.env.ETHEREUM_RPC_URL?.trim() || 'https://ethereum-rpc.publicnode.com'),
})
const solana = await createDynamicSolanaClient({
  client: dynamicSolana,
  walletMetadata: solanaMetadata,
  password: required('DYNAMIC_SOLANA_WALLET_PASSWORD'),
  chainId: '101', // Dynamic's Solana mainnet identifier; the RPC MUST target mainnet.
  transport: solanaHttp(required('SOLANA_RPC_URL')),
})

const bridge = createBridgeClient({ environment: 'mainnet', clients: { ethereum, solana } })
console.log({
  environment: bridge.environment,
  ethereum: await ethereum.walletClient!.getAddress(),
  solana: await solana.walletClient!.getAddress(),
})
// For caller-managed MPC shares, load externalServerKeyShares from a secrets store
// and pass them alongside the full walletMetadata in the corresponding helper.
