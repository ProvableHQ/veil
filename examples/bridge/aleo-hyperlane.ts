import {
  createAleoClient,
  createBridgeClient,
  createEvmClient,
  createSolanaClient,
  DEFAULT_SOLANA_RPC_URL,
  evmHttp,
  parseDecimalAmount,
  solanaHttp,
} from '@provablehq/aleo-bridge-sdk'

const EXECUTION_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_MOVES_REAL_FUNDS'
const EXECUTION_ENVIRONMENT_VARIABLE = 'EXECUTE_BRIDGE'
const ALEO_CONFIRMATION_TIMEOUT_MS = 5 * 60_000

type AleoHyperlaneAsset = 'ETH' | 'SOL' | 'WBTC'
type AssetConfiguration = {
  source: { chain: string, asset: string }
  destination: { chain: string, asset: string }
  balanceProgram: string
  amount: string
  recipientEnvironmentVariable: string
}

const ASSETS: Record<AleoHyperlaneAsset, AssetConfiguration> = {
  ETH: {
    source: { chain: 'aleo', asset: 'eth' },
    destination: { chain: 'ethereum', asset: 'eth' },
    balanceProgram: 'arc20_eth.aleo',
    amount: '0.000000000000000001',
    recipientEnvironmentVariable: 'ETHEREUM_RECIPIENT',
  },
  SOL: {
    source: { chain: 'aleo', asset: 'sol' },
    destination: { chain: 'solana', asset: 'sol' },
    balanceProgram: 'arc20_sol.aleo',
    amount: '0.000000001',
    recipientEnvironmentVariable: 'SOLANA_RECIPIENT',
  },
  WBTC: {
    source: { chain: 'aleo', asset: 'wbtc' },
    destination: { chain: 'ethereum', asset: 'wbtc' },
    balanceProgram: 'arc20_wbtc.aleo',
    amount: '0.00000001',
    recipientEnvironmentVariable: 'ETHEREUM_RECIPIENT',
  },
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function parseUnsignedLiteral(value: string | null, width: 'u128'): bigint {
  if (value == null) return 0n
  const match = new RegExp(`^(0|[1-9][0-9]*)${width}$`).exec(value.trim())
  if (!match) throw new Error(`Expected an Aleo ${width} literal, received ${value}`)
  return BigInt(match[1]!)
}

function formatAmount(value: bigint, decimals: number): string {
  const unit = 10n ** BigInt(decimals)
  const whole = value / unit
  const fraction = (value % unit).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

/**
 * Quotes or submits one reviewed Aleo-origin Hyperlane route.
 *
 * Reads a public ARC-20 balance and the live interchain gas paymaster quote
 * without a record scanner. Execution requotes the hook payment and burns
 * through the signer-bound Warp Route transition.
 *
 * @param asset Aleo-origin asset whose return journey runs.
 * @returns A promise that resolves after preflight or accepted Aleo submission.
 * @throws Error When route metadata, balances, the live gas quote, or execution fails.
 *
 * @example
 * await runAleoHyperlaneExample('ETH')
 */
export async function runAleoHyperlaneExample(asset: AleoHyperlaneAsset): Promise<void> {
  const config = ASSETS[asset]
  const recipient = requiredEnvironmentVariable(config.recipientEnvironmentVariable)
  const privateKey = requiredEnvironmentVariable('ALEO_PRIVATE_KEY')
  const networkUrl = process.env.ALEO_RPC_URL?.trim() || 'https://api.provable.com/v2'
  const consumerId = process.env.ALEO_CONSUMER_ID?.trim()
  const apiKey = process.env.ALEO_DPS_API_KEY?.trim()
  if ((consumerId && !apiKey) || (!consumerId && apiKey)) {
    throw new Error('ALEO_CONSUMER_ID and ALEO_DPS_API_KEY must be supplied together')
  }

  const { loadNetwork } = await import('@provablehq/veil-aleo-sdk')
  const aleo = await loadNetwork('mainnet')
  const { publicClient, walletClient: nativeWalletClient, account } = aleo.createAleoClient({
    privateKey,
    networkUrl,
    provingMode: 'delegated',
    ...(consumerId && apiKey ? { consumerId, apiKey } : {}),
    useFeeMaster: false,
    confirmationTimeout: ALEO_CONFIRMATION_TIMEOUT_MS,
  })

  const executionEnabled = process.env[EXECUTION_ENVIRONMENT_VARIABLE] === EXECUTION_ACKNOWLEDGEMENT
  const destinationClient = executionEnabled
    ? config.destination.chain === 'ethereum'
      ? createEvmClient({ transport: evmHttp(requiredEnvironmentVariable('ETHEREUM_RPC_URL')) })
      : createSolanaClient({
          transport: solanaHttp(process.env.SOLANA_RPC_URL?.trim() || DEFAULT_SOLANA_RPC_URL),
        })
    : undefined

  const bridge = createBridgeClient({
    environment: 'mainnet',
    clients: {
      aleo: createAleoClient({ publicClient, account: nativeWalletClient }),
      ...(destinationClient ? { [config.destination.chain]: destinationClient } : {}),
    },
  })

  const plan = bridge.prepare({
    source: config.source,
    destination: config.destination,
    bridgeProtocol: 'hyperlane',
    amount: config.amount,
    recipient,
    sender: String(account.address),
  })
  const amountAtomic = parseDecimalAmount(plan.amountIn, plan.sourceAsset.decimals)

  const [assetLiteral, publicCredits, gasQuote] = await Promise.all([
    publicClient.readContract({ programId: config.balanceProgram, mapping: 'balances', key: account.address }),
    publicClient.getBalance({ address: account.address }),
    bridge.quote({ plan }),
  ])
  if (gasQuote.kind !== 'aleo-hyperlane') throw new Error(`Unexpected quote kind: ${gasQuote.kind}`)
  const assetBalance = parseUnsignedLiteral(assetLiteral, 'u128')

  console.log(`Read-only Aleo ${asset} to ${config.destination.chain} ${asset} preflight`)
  console.table({
    route: plan.route.id,
    sender: account.address,
    recipient,
    amount: `${formatAmount(amountAtomic, plan.sourceAsset.decimals)} ${asset}`,
    [`${asset.toLowerCase()}PublicBalance`]: `${formatAmount(assetBalance, plan.sourceAsset.decimals)} ${asset}`,
    publicCreditsBalance: `${formatAmount(publicCredits, 6)} credits`,
    hyperlaneHookPayment: `${formatAmount(gasQuote.paymentMicrocredits, 6)} credits`,
    sourceOperation: 'selected by plan.route',
    sourceBalanceType: 'public',
    recordScanner: 'not used',
  })

  if (!executionEnabled) {
    console.log(`\nPreflight complete; no ${asset} was burned.`)
    console.log(`Set ${EXECUTION_ENVIRONMENT_VARIABLE}=${EXECUTION_ACKNOWLEDGEMENT} to submit the transfer.`)
    return
  }
  if (assetBalance < amountAtomic) throw new Error(`Insufficient public Aleo ${asset} balance`)

  const latestQuote = await bridge.quote({ plan })
  if (latestQuote.kind !== 'aleo-hyperlane') throw new Error(`Unexpected quote kind: ${latestQuote.kind}`)
  if (publicCredits < latestQuote.paymentMicrocredits) {
    throw new Error(`Insufficient public credits for the Hyperlane hook payment of ${latestQuote.paymentMicrocredits} microcredits`)
  }
  if (latestQuote.paymentMicrocredits !== gasQuote.paymentMicrocredits) {
    console.log(`Hyperlane hook quote changed from ${gasQuote.paymentMicrocredits} to ${latestQuote.paymentMicrocredits} microcredits; using the latest quote.`)
  }
  if (consumerId && apiKey) await nativeWalletClient.authenticateProvableApi()

  const result = await bridge.execute({
    plan,
    mode: 'signer',
    privateFee: false,
    gasPaymentMicrocredits: latestQuote.paymentMicrocredits,
    onCheckpoint(checkpoint) {
      console.log('Optional recovery checkpoint:', JSON.stringify(checkpoint))
    },
  })
  if (result.kind !== 'aleo-hyperlane') throw new Error(`Unexpected execution kind: ${result.kind}`)
  const progress = await bridge.wait({ progress: { next: 'wait', plan, receipt: result.receipt } })
  if (progress.next === 'failed') throw new Error(progress.error)
  if (progress.next !== 'done') throw new Error(`Unexpected next operation: ${progress.next}`)
  console.log(`\nAleo ${asset} bridge completed:`, progress.receipt)
}
