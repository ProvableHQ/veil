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
const EXECUTION_ENVIRONMENT_VARIABLE = 'EXECUTE_BRIDGE'
const ERC20_READ_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
])

type HyperlaneAsset = 'ETH' | 'WBTC'
type AssetConfiguration = {
  source: { chain: string, asset: string }
  destination: { chain: string, asset: string }
  amount: string
}

const ASSETS: Record<HyperlaneAsset, AssetConfiguration> = {
  ETH: {
    source: { chain: 'ethereum', asset: 'eth' },
    destination: { chain: 'aleo', asset: 'eth' },
    amount: '0.000000000000000001',
  },
  WBTC: {
    source: { chain: 'ethereum', asset: 'wbtc' },
    destination: { chain: 'aleo', asset: 'wbtc' },
    amount: '0.00000001',
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

/**
 * Quotes or submits one reviewed mainnet Ethereum-to-Aleo Hyperlane route.
 *
 * The example signs locally with a viem private-key account. It is read-only
 * unless the shared execution acknowledgement is set. WBTC allowance
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

  // ── The clients ─────────────────────────────────────────────────────
  // The EVM account signs locally, while the transport handles public reads
  // and broadcasts signed transactions. Aleo needs only a public client here:
  // Hyperlane's relayer performs the destination mint, and `wait` reads the
  // Aleo mailbox to verify that the message was delivered.
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

  // ── The plan ────────────────────────────────────────────────────────
  // Structured endpoints are caller input. The route id, token metadata, and
  // destination domain come from the registry selected by the bridge client.
  // Each tutorial route transfers one atomic unit; network and relayer fees are
  // quoted separately and normally cost more than the transferred amount.
  const plan = bridge.prepare({
    source: config.source,
    destination: config.destination,
    bridgeProtocol: 'hyperlane',
    amount: config.amount,
    recipient,
    sender,
  })

  // ── The quote ───────────────────────────────────────────────────────
  // `quote` performs reads only. Native ETH needs a value quote; WBTC also
  // needs token balance and allowance reads because an insufficient allowance
  // adds an approval transaction before the irreversible dispatch.
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
    amount: `${formatUnits(quote.amountAtomic, plan.sourceAsset.decimals)} ${asset}`,
    assetBalance: `${formatUnits(assetBalance, plan.sourceAsset.decimals)} ${asset}`,
    nativeBalance: `${formatEther(nativeBalance)} ETH`,
    hyperlaneFee: `${formatEther(quote.nativeFeeAtomic)} ETH`,
    transactionValue: `${formatEther(quote.nativeValueAtomic)} ETH`,
    approvalRequired: asset === 'WBTC' ? approvalRequired : false,
    allowance: allowance == null ? 'not applicable' : `${formatUnits(allowance, plan.sourceAsset.decimals)} WBTC`,
    tokenContract: quote.tokenAddress ?? 'native ETH',
    warpRouteContract: quote.routerAddress,
    destinationDomain: quote.destinationDomain,
    recipientBytes32: quote.recipientBytes32,
  })

  // ── The execution ───────────────────────────────────────────────────
  // The normal path ends after printing the quote. Requiring an exact value
  // prevents a copied example or mistyped command from moving funds.
  if (process.env[EXECUTION_ENVIRONMENT_VARIABLE] !== EXECUTION_ACKNOWLEDGEMENT) {
    console.log('\nQuote complete; no transaction was submitted.')
    console.log(
      asset === 'WBTC' && approvalRequired
        ? `Set ${EXECUTION_ENVIRONMENT_VARIABLE}=${EXECUTION_ACKNOWLEDGEMENT} to approve WBTC and dispatch the transfer.`
        : `Set ${EXECUTION_ENVIRONMENT_VARIABLE}=${EXECUTION_ACKNOWLEDGEMENT} to dispatch the transfer.`,
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

  // `execute` owns the approval-and-dispatch sequence. Each submitted id is
  // emitted through `onCheckpoint` before confirmation polling, which gives an
  // application a recovery boundary without making the SDK own its storage.
  const execution = await bridge.execute({
    plan,
    confirmationTimeoutMs: DEFAULT_EVM_CONFIRMATION_TIMEOUT_MS,
    onCheckpoint(checkpoint) {
      console.log('Optional recovery checkpoint:', JSON.stringify(checkpoint))
    },
  })
  if (execution.kind !== 'evm-hyperlane') throw new Error(`Unexpected execution kind: ${execution.kind}`)

  // ── Settlement and recovery ─────────────────────────────────────────
  // `wait` is read-only. A `resume` result means an approval confirmed but the
  // bridge dispatch did not happen; `resume` authorizes only that remaining
  // source transaction, then settlement returns to the same read-only wait.
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
