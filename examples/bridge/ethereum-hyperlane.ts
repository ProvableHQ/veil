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
 * Moves native ETH or WBTC from Ethereum to its wrapped representation on
 * Aleo through Hyperlane.
 *
 * The default run reads balances and current fees, prints them, and exits
 * without requesting a signature. With execution enabled, the viem account
 * created from this process's private key signs the Ethereum transaction. WBTC
 * may require an approval first; native ETH is dispatched directly. Hyperlane
 * relays the message and mints the corresponding wrapped asset to the Aleo recipient.
 *
 * @param asset ETH or WBTC to lock on Ethereum and mint on Aleo.
 * @returns After read-only inspection or verified Aleo delivery, depending on
 * the execution acknowledgement.
 * @throws Error When configuration is missing, funds are insufficient, an
 * Ethereum transaction fails, or Aleo delivery cannot be verified.
 *
 * @example
 * await runEthereumHyperlaneExample('ETH')
 */
export async function runEthereumHyperlaneExample(asset: HyperlaneAsset): Promise<void> {
  const config = ASSETS[asset]
  const rpcUrl = requiredEnvironmentVariable('ETHEREUM_RPC_URL')
  const recipient = requiredEnvironmentVariable('ALEO_RECIPIENT')

  // ── Connect the source account and destination network ──────────────
  // The EVM client reads Ethereum state, signs with the configured private key,
  // and broadcasts through the selected RPC endpoint. The Aleo client has no
  // account because the Hyperlane relayer submits the destination mint. It is
  // used only to verify the delivered message in Aleo's canonical Mailbox.
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

  // ── Describe the intended transfer ──────────────────────────────────
  // The caller supplies familiar chain and asset names, an amount, and the
  // recipient. The bridge catalog supplies the reviewed router, token contract,
  // destination domain, decimal widths, and required stages for that direction.
  // No network is read and no wallet is involved here. Each example transfers
  // one atomic unit; Ethereum gas and the relayer payment cost more than that.
  const plan = bridge.prepare({
    source: config.source,
    destination: config.destination,
    bridgeProtocol: 'hyperlane',
    amount: config.amount,
    recipient,
    sender,
  })

  // ── Check funds and current fees ────────────────────────────────────
  // Hyperlane's router reports the value required to send the asset and pay the
  // destination relayer. WBTC also needs visible ERC-20 balance and allowance
  // reads. None of these calls requests a signature or changes Ethereum state.
  // A low WBTC allowance means execution needs an approval before dispatch.
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

  // ── Stop before the fund-moving boundary by default ─────────────────
  // A normal run ends after printing the route, balances, allowance, and fees.
  // The exact acknowledgement makes mainnet submission an explicit operator
  // decision rather than a side effect of copying or inspecting the tutorial.
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

  // An ERC-20 approval changes only how much WBTC the reviewed router may use;
  // it does not transfer the token. The following dispatch is the irreversible
  // boundary: it locks or burns the source asset and creates the message that
  // Hyperlane must deliver. Every submitted Ethereum transaction also costs gas.
  console.log('\nExecution enabled. The private key held by this process will sign and broadcast; no wallet prompt will appear.')
  console.log(asset === 'WBTC' && approvalRequired
    ? 'Submitting an exact WBTC approval, waiting for confirmation, then dispatching through Hyperlane.'
    : `Submitting the ${asset} transfer directly through Hyperlane; no approval transaction is needed.`)

  const execution = await bridge.execute({
    plan,
    confirmationTimeoutMs: DEFAULT_EVM_CONFIRMATION_TIMEOUT_MS,
    onCheckpoint(checkpoint) {
      // The callback runs after each transaction is broadcast and before the
      // example waits for confirmation. A durable application atomically
      // replaces its saved checkpoint here; the SDK and this example do not
      // choose or manage storage. The checkpoint contains no signing key.
      console.log('Optional recovery checkpoint:', JSON.stringify(checkpoint))
    },
  })
  if (execution.kind !== 'evm-hyperlane') throw new Error(`Unexpected execution kind: ${execution.kind}`)

  // ── Observe settlement without repeating completed work ────────────
  // From this point, chain and relayer reads determine what happened. A timeout
  // or RPC error after broadcast is an unknown outcome, not proof of failure;
  // use the latest checkpoint to recover rather than starting another transfer.
  // Completion requires both the Ethereum dispatch and the canonical Aleo
  // Mailbox delivery, not merely a successful source receipt.
  let progress = await bridge.wait({ progress: { next: 'wait', plan, receipt: execution.receipt } })
  if (progress.next === 'resume') {
    // This state can occur when a WBTC approval confirmed but no dispatch was
    // submitted. Resuming asks the same source account to authorize only that
    // remaining dispatch. It never repeats the confirmed approval.
    const resumed = await bridge.resume({
      progress,
      onCheckpoint(checkpoint) {
        // Replace the earlier approval checkpoint with the dispatch checkpoint.
        console.log('Optional recovery checkpoint:', JSON.stringify(checkpoint))
      },
    })
    progress = await bridge.wait({ progress: { next: 'wait', plan, receipt: resumed.receipt } })
  }
  if (progress.next === 'failed') throw new Error(progress.error)
  if (progress.next !== 'done') throw new Error(`Unexpected next operation: ${progress.next}`)
  console.log('Bridge completed:', progress.receipt)
}
