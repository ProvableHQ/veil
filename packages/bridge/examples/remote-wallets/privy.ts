/** Configures existing Privy server wallets and prints their public addresses without signing or submitting. */
import { PrivyClient } from '@privy-io/node'
import { createBridgeClient, evmHttp, solanaHttp } from '@provablehq/aleo-bridge-sdk'
import { createPrivyEvmClient, createPrivySolanaClient } from '@provablehq/aleo-bridge-sdk/privy'
import { getAddress } from 'viem'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Set ${name} before running this example`)
  return value
}

const privy = new PrivyClient({
  appId: required('PRIVY_APP_ID'),
  appSecret: required('PRIVY_APP_SECRET'),
})
const authorizationKey = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY
const authorizationContext = authorizationKey
  ? { authorization_private_keys: [authorizationKey] }
  : undefined

const ethereum = await createPrivyEvmClient({
  client: privy,
  walletId: required('PRIVY_EVM_WALLET_ID'),
  address: getAddress(required('PRIVY_EVM_ADDRESS')),
  authorizationContext,
  transport: evmHttp(required('ETHEREUM_RPC_URL')),
})
const solana = await createPrivySolanaClient({
  client: privy,
  walletId: required('PRIVY_SOLANA_WALLET_ID'),
  address: required('PRIVY_SOLANA_ADDRESS'),
  authorizationContext,
  transport: solanaHttp(required('SOLANA_RPC_URL')),
})

const bridge = createBridgeClient({ environment: 'mainnet', clients: { ethereum, solana } })
console.log({
  environment: bridge.environment,
  ethereum: await ethereum.walletClient!.getAddress(),
  solana: await solana.walletClient!.getAddress(),
})
// Add an Aleo client when the chosen route needs Aleo reads or authorization.
// Continue with bridge.quote, execute, wait, and durable checkpoints as in the bridge tutorial.
