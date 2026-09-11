import {
  decodeFunctionResult,
  encodeFunctionData,
  formatEther,
  formatUnits,
  parseAbi,
  type Hex,
} from 'viem'
import { createPublicClient as createAleoPublicClient, http as aleoHttp } from '@provablehq/veil-core'
import {
  createAleoClient,
  createBridgeClient,
  createEvmClient,
  evmHttp,
  evmPrivateKey,
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
  source: { chain: string, asset: string }
  destination: { chain: string, asset: string }
  decimals: number
}

const ASSETS: Record<HyperlaneAsset, AssetConfiguration> = {
  ETH: {
    symbol: 'ETH',
    amountEnvironmentVariable: 'ETH_AMOUNT',
    executionEnvironmentVariable: 'EXECUTE_HYPERLANE_ETH',
    source: { chain: 'ethereum', asset: 'eth' },
    destination: { chain: 'aleo', asset: 'eth' },
    decimals: 18,
  },
  WBTC: {
    symbol: 'WBTC',
    amountEnvironmentVariable: 'WBTC_AMOUNT',
    executionEnvironmentVariable: 'EXECUTE_HYPERLANE_WBTC',
    source: { chain: 'ethereum', asset: 'wbtc' },
    destination: { chain: 'aleo', asset: 'wbtc' },
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
  const evm = createEvmClient({
    transport: evmHttp(rpcUrl),
    account: evmPrivateKey(privateKeyFromEnvironment()),
  })
  const sender = await evm.walletClient!.getAddress()
  const bridge = createBridgeClient({
    environment: 'mainnet',
    clients: {
      ethereum: evm,
      aleo: createAleoClient({
        publicClient: createAleoPublicClient({
          transport: aleoHttp(process.env.ALEO_RPC_URL?.trim() || 'https://api.provable.com/v2', { network: 'mainnet' }),
        }),
      }),
    },
  })
  const plan = bridge.prepare({
    source: config.source,
    destination: config.destination,
    bridgeProtocol: 'hyperlane',
    amount,
    recipient,
    sender,
  })
  const quote = await bridge.quote({ plan })
  if (quote.kind !== 'evm-hyperlane') throw new Error(`Unexpected quote kind: ${quote.kind}`)
  const nativeBalance = await evm.publicClient.getBalance(sender)

  let assetBalance = nativeBalance
  let allowance: bigint | undefined
  let approvalRequired = false
  if (asset === 'WBTC') {
    if (!quote.tokenAddress || quote.tokenAmountAtomic == null) {
      throw new Error('The reviewed WBTC route did not return collateral token metadata')
    }
    ;[assetBalance, allowance] = await Promise.all([
      evm.publicClient.call({
        to: quote.tokenAddress,
        data: encodeFunctionData({ abi: ERC20_READ_ABI, functionName: 'balanceOf', args: [sender] }),
      }).then((data) => decodeFunctionResult({ abi: ERC20_READ_ABI, functionName: 'balanceOf', data })),
      evm.publicClient.call({
        to: quote.tokenAddress,
        data: encodeFunctionData({ abi: ERC20_READ_ABI, functionName: 'allowance', args: [sender, quote.routerAddress] }),
      }).then((data) => decodeFunctionResult({ abi: ERC20_READ_ABI, functionName: 'allowance', data })),
    ])
    approvalRequired = allowance < quote.tokenAmountAtomic
  }

  console.log(`Read-only Hyperlane ${asset} preflight`)
  console.table({
    route: quote.routeId,
    sender,
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
    recipientBytes32: quote.recipientBytes32,
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
  const execution = await bridge.execute({
    plan,
    confirmationTimeoutMs: millisecondsFromEnvironment(
      'EVM_CONFIRMATION_TIMEOUT_MS',
      DEFAULT_EVM_CONFIRMATION_TIMEOUT_MS,
    ),
    onCheckpoint(checkpoint) {
      console.log('Optional recovery checkpoint:', JSON.stringify(checkpoint))
    },
  })
  if (execution.kind !== 'evm-hyperlane') throw new Error(`Unexpected execution kind: ${execution.kind}`)
  let progress = await bridge.wait({ progress: { next: 'wait', plan, receipt: execution.receipt } })
  if (progress.next === 'resume') {
    const resumed = await bridge.resume({
      progress,
      onCheckpoint(checkpoint) {
        console.log('Optional recovery checkpoint:', JSON.stringify(checkpoint))
      },
    })
    progress = await bridge.wait({ progress: { next: 'wait', plan, receipt: resumed.receipt } })
  }
  if (progress.next === 'failed') throw new Error(progress.error)
  if (progress.next !== 'done') throw new Error(`Unexpected next operation: ${progress.next}`)
  console.log('Bridge completed:', progress.receipt)
}
