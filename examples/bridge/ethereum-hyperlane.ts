import {
  createPublicClient,
  createWalletClient,
  formatEther,
  formatUnits,
  http,
  parseAbi,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import {
  aleoAddressToBytes32,
  createBridgeClient,
  createEvmClient,
} from '@provablehq/aleo-bridge-sdk'

const EXECUTION_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_MOVES_REAL_FUNDS'
const DEFAULT_EVM_CONFIRMATION_TIMEOUT_MS = 5 * 60_000
const ERC20_READ_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
])

type HyperlaneAsset = 'ETH' | 'WBTC'
type AssetConfiguration = {
  symbol: HyperlaneAsset
  amountEnvironmentVariable: string
  executionEnvironmentVariable: string
  routeId: string
  decimals: number
}

const ASSETS: Record<HyperlaneAsset, AssetConfiguration> = {
  ETH: {
    symbol: 'ETH',
    amountEnvironmentVariable: 'ETH_AMOUNT',
    executionEnvironmentVariable: 'EXECUTE_HYPERLANE_ETH',
    routeId: 'hyperlane:ethereum/eth->aleo/eth',
    decimals: 18,
  },
  WBTC: {
    symbol: 'WBTC',
    amountEnvironmentVariable: 'WBTC_AMOUNT',
    executionEnvironmentVariable: 'EXECUTE_HYPERLANE_WBTC',
    routeId: 'hyperlane:ethereum/wbtc->aleo/wbtc',
    decimals: 8,
  },
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function privateKeyFromEnvironment(): Hex {
  const value = requiredEnvironmentVariable('EVM_PRIVATE_KEY')
  const unprefixed = value.startsWith('0x') || value.startsWith('0X')
    ? value.slice(2)
    : value
  if (!/^[0-9a-f]{64}$/i.test(unprefixed)) {
    throw new Error('EVM_PRIVATE_KEY must contain exactly 32 bytes (64 hexadecimal characters), with or without a 0x prefix')
  }
  return `0x${unprefixed}` as Hex
}

function millisecondsFromEnvironment(name: string, defaultValue: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return defaultValue
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1_000) {
    throw new Error(`${name} must be an integer greater than or equal to 1000`)
  }
  return value
}

function createLocalSigner(rpcUrl: string, privateKey: Hex) {
  const account = privateKeyToAccount(privateKey)
  const transport = http(rpcUrl)
  const publicClient = createPublicClient({ chain: mainnet, transport })
  const walletClient = createWalletClient({ account, chain: mainnet, transport })
  return { account, walletClient, publicClient }
}

/**
 * Quotes or submits one reviewed mainnet Ethereum-to-Aleo Hyperlane route.
 *
 * The example signs locally with a viem private-key account. It is read-only
 * unless the asset-specific execution acknowledgement is set. WBTC allowance
 * is displayed before execution; the bridge client submits an exact approval
 * only when that allowance is insufficient. Native ETH has no approval step.
 *
 * @param asset Asset-specific demo to run.
 * @returns A promise that resolves after quoting or after the submitted source transaction is confirmed or times out.
 * @throws Error When environment input, the live quote, balances, allowance reads, or submission fails.
 *
 * @example
 * await runEthereumHyperlaneExample('ETH')
 */
export async function runEthereumHyperlaneExample(asset: HyperlaneAsset): Promise<void> {
  const config = ASSETS[asset]
  const rpcUrl = requiredEnvironmentVariable('ETHEREUM_RPC_URL')
  const recipient = requiredEnvironmentVariable('ALEO_RECIPIENT')
  const amount = requiredEnvironmentVariable(config.amountEnvironmentVariable)
  const { account, walletClient, publicClient } = createLocalSigner(rpcUrl, privateKeyFromEnvironment())
  const recipientBytes32 = aleoAddressToBytes32(recipient)
  const bridge = createBridgeClient({
    environment: 'mainnet',
    clients: { ethereum: createEvmClient({ publicClient, walletClient }) },
  })
  const plan = bridge.prepareTransfer({
    routeId: config.routeId,
    amount,
    recipient,
    sender: account.address,
  })
  const quote = await bridge.quoteEvmHyperlaneTransfer({ plan, recipientBytes32 })
  const nativeBalance = await publicClient.getBalance({ address: account.address })

  let assetBalance = nativeBalance
  let allowance: bigint | undefined
  let approvalRequired = false
  if (asset === 'WBTC') {
    if (!quote.tokenAddress || quote.tokenAmountAtomic == null) {
      throw new Error('The reviewed WBTC route did not return collateral token metadata')
    }
    ;[assetBalance, allowance] = await Promise.all([
      publicClient.readContract({
        address: quote.tokenAddress,
        abi: ERC20_READ_ABI,
        functionName: 'balanceOf',
        args: [account.address],
      }),
      publicClient.readContract({
        address: quote.tokenAddress,
        abi: ERC20_READ_ABI,
        functionName: 'allowance',
        args: [account.address, quote.routerAddress],
      }),
    ])
    approvalRequired = allowance < quote.tokenAmountAtomic
  }

  console.log(`Read-only Hyperlane ${asset} preflight`)
  console.table({
    route: quote.routeId,
    sender: account.address,
    recipient,
    amount: `${formatUnits(quote.amountAtomic, config.decimals)} ${asset}`,
    assetBalance: `${formatUnits(assetBalance, config.decimals)} ${asset}`,
    nativeBalance: `${formatEther(nativeBalance)} ETH`,
    hyperlaneFee: `${formatEther(quote.nativeFeeAtomic)} ETH`,
    transactionValue: `${formatEther(quote.nativeValueAtomic)} ETH`,
    approvalRequired: asset === 'WBTC' ? approvalRequired : false,
    allowance: allowance == null ? 'not applicable' : `${formatUnits(allowance, config.decimals)} WBTC`,
    tokenContract: quote.tokenAddress ?? 'native ETH',
    warpRouteContract: quote.routerAddress,
    destinationDomain: quote.destinationDomain,
    recipientBytes32,
  })

  if (process.env[config.executionEnvironmentVariable] !== EXECUTION_ACKNOWLEDGEMENT) {
    console.log('\nQuote complete; no transaction was submitted.')
    console.log(
      asset === 'WBTC' && approvalRequired
        ? `Set ${config.executionEnvironmentVariable}=${EXECUTION_ACKNOWLEDGEMENT} to approve WBTC and dispatch the transfer.`
        : `Set ${config.executionEnvironmentVariable}=${EXECUTION_ACKNOWLEDGEMENT} to dispatch the transfer.`,
    )
    return
  }

  if (assetBalance < quote.amountAtomic) {
    throw new Error(`Insufficient ${asset} balance for the quoted transfer`)
  }
  if (nativeBalance <= quote.nativeValueAtomic) {
    throw new Error('Insufficient ETH balance for the quoted transaction value plus Ethereum gas')
  }

  console.log('\nExecution enabled. The local viem signer will automatically sign and broadcast; no wallet prompt will appear.')
  console.log(asset === 'WBTC' && approvalRequired
    ? 'Submitting an exact WBTC approval, waiting for confirmation, then dispatching through Hyperlane.'
    : `Submitting the ${asset} transfer directly through Hyperlane; no approval transaction is needed.`)
  const execution = await bridge.executeEvmHyperlaneTransfer({
    plan,
    recipientBytes32,
    confirmationTimeoutMs: millisecondsFromEnvironment(
      'EVM_CONFIRMATION_TIMEOUT_MS',
      DEFAULT_EVM_CONFIRMATION_TIMEOUT_MS,
    ),
  })

  console.log('Approval transaction(s):', execution.approvalTxIds)
  console.log('Transfer status:', execution.receipt.status)
  if (execution.receipt.status === 'SOURCE_APPROVAL_PENDING') {
    console.log('WBTC approval status: pending confirmation')
    console.log('Hyperlane transfer status: not submitted')
    console.log('After the approval confirms, rerun the same command; the client will observe the allowance and dispatch.')
    return
  }
  if (execution.receipt.status === 'SOURCE_CONFIRMING') {
    console.log(`${asset} approval status: ${asset === 'WBTC' ? 'confirmed or previously sufficient' : 'not applicable'}`)
    console.log('Transfer transaction:', execution.receipt.sourceTxId)
    console.log('Hyperlane transfer status: pending Ethereum confirmation')
    return
  }

  console.log(`${asset} approval status: ${asset === 'WBTC' ? execution.approvalTxIds.length ? 'confirmed' : 'previously sufficient' : 'not applicable'}`)
  console.log('Transfer transaction:', execution.receipt.sourceTxId)
  console.log('Ethereum dispatch status: confirmed')
  console.log('Hyperlane message id:', execution.receipt.messageId ?? 'not found in the confirmed receipt')
  console.log('A Hyperlane relayer will process the Aleo mint independently of this script.')
}
