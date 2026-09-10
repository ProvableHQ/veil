import {
  buildAleoHyperlaneTransferRemoteCall,
  createAleoClient,
  createBridgeClient,
} from '@provablehq/aleo-bridge-sdk'

const EXECUTION_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_MOVES_REAL_FUNDS'

type AleoHyperlaneAsset = 'ETH' | 'SOL' | 'WBTC'
type AssetConfiguration = {
  symbol: AleoHyperlaneAsset
  source: { chain: string, asset: string }
  destination: { chain: string, asset: string }
  balanceProgram: string
  decimals: number
  destinationName: string
  recipientEnvironmentVariable: string
  amountEnvironmentVariable: string
  executionEnvironmentVariable: string
}

const ASSETS: Record<AleoHyperlaneAsset, AssetConfiguration> = {
  ETH: {
    symbol: 'ETH',
    source: { chain: 'aleo', asset: 'eth' },
    destination: { chain: 'ethereum', asset: 'eth' },
    balanceProgram: 'arc20_eth.aleo',
    decimals: 18,
    destinationName: 'Ethereum',
    recipientEnvironmentVariable: 'ETHEREUM_RECIPIENT',
    amountEnvironmentVariable: 'ETH_AMOUNT',
    executionEnvironmentVariable: 'EXECUTE_HYPERLANE_ETH_RETURN',
  },
  SOL: {
    symbol: 'SOL',
    source: { chain: 'aleo', asset: 'sol' },
    destination: { chain: 'solana', asset: 'sol' },
    balanceProgram: 'arc20_sol.aleo',
    decimals: 9,
    destinationName: 'Solana',
    recipientEnvironmentVariable: 'SOLANA_RECIPIENT',
    amountEnvironmentVariable: 'SOL_AMOUNT',
    executionEnvironmentVariable: 'EXECUTE_HYPERLANE_SOL_RETURN',
  },
  WBTC: {
    symbol: 'WBTC',
    source: { chain: 'aleo', asset: 'wbtc' },
    destination: { chain: 'ethereum', asset: 'wbtc' },
    balanceProgram: 'arc20_wbtc.aleo',
    decimals: 8,
    destinationName: 'Ethereum',
    recipientEnvironmentVariable: 'ETHEREUM_RECIPIENT',
    amountEnvironmentVariable: 'WBTC_AMOUNT',
    executionEnvironmentVariable: 'EXECUTE_HYPERLANE_WBTC_RETURN',
  },
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function booleanFromEnvironment(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  if (!raw) return defaultValue
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error(`${name} must be true or false`)
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
  const amount = requiredEnvironmentVariable(config.amountEnvironmentVariable)
  const recipient = requiredEnvironmentVariable(config.recipientEnvironmentVariable)
  const privateKey = requiredEnvironmentVariable('ALEO_PRIVATE_KEY')
  const networkUrl = process.env.ALEO_RPC_URL?.trim() || 'https://api.provable.com/v2'
  const provingMode = process.env.ALEO_PROVING_MODE?.trim() || 'delegated'
  if (provingMode !== 'delegated' && provingMode !== 'local') {
    throw new Error('ALEO_PROVING_MODE must be delegated or local')
  }
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
    provingMode,
    ...(process.env.ALEO_PROVER_URL?.trim() ? { proverUrl: process.env.ALEO_PROVER_URL.trim() } : {}),
    ...(consumerId && apiKey ? { consumerId, apiKey } : {}),
    useFeeMaster: booleanFromEnvironment('ALEO_USE_FEE_MASTER', true),
    confirmationTimeout: millisecondsFromEnvironment('ALEO_EXECUTION_CONFIRMATION_TIMEOUT_MS', 5 * 60_000),
  })

  const bridge = createBridgeClient({
    environment: 'mainnet',
    clients: { aleo: createAleoClient({ publicClient, account: nativeWalletClient }) },
  })

  const plan = bridge.prepare({
    source: config.source,
    destination: config.destination,
    bridgeProtocol: 'hyperlane',
    amount,
    recipient,
  })
  const previewCall = buildAleoHyperlaneTransferRemoteCall(bridge.registry, { plan, mode: 'signer' })
  if (previewCall.placeholderFields.length !== 1 || previewCall.placeholderFields[0] !== 'aleoAllowanceAmount0') {
    throw new Error(`${asset} return route has unresolved fields: ${previewCall.placeholderFields.join(', ') || 'unknown'}`)
  }

  const [assetLiteral, publicCredits, gasQuote] = await Promise.all([
    publicClient.readContract({ programId: config.balanceProgram, mapping: 'balances', key: account.address }),
    publicClient.getBalance({ address: account.address }),
    bridge.quote({ plan }),
  ])
  if (gasQuote.kind !== 'aleo-hyperlane') throw new Error(`Unexpected quote kind: ${gasQuote.kind}`)
  const assetBalance = parseUnsignedLiteral(assetLiteral, 'u128')

  console.log(`Read-only Aleo ${asset} to ${config.destinationName} ${asset} preflight`)
  console.table({
    route: plan.route.id,
    sender: account.address,
    recipient,
    amount: `${formatAmount(previewCall.amountAtomic, config.decimals)} ${asset}`,
    [`${asset.toLowerCase()}PublicBalance`]: `${formatAmount(assetBalance, config.decimals)} ${asset}`,
    publicCreditsBalance: `${formatAmount(publicCredits, 6)} credits`,
    hyperlaneHookPayment: `${formatAmount(gasQuote.paymentMicrocredits, 6)} credits`,
    sourceOperation: `${previewCall.program}/${previewCall.function}`,
    sourceBalanceType: 'public',
    recordScanner: 'not used',
  })

  if (process.env[config.executionEnvironmentVariable] !== EXECUTION_ACKNOWLEDGEMENT) {
    console.log(`\nPreflight complete; no ${asset} was burned.`)
    console.log(`Set ${config.executionEnvironmentVariable}=${EXECUTION_ACKNOWLEDGEMENT} to submit the transfer.`)
    return
  }
  if (assetBalance < previewCall.amountAtomic) throw new Error(`Insufficient public Aleo ${asset} balance`)

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
    privateFee: booleanFromEnvironment('ALEO_PRIVATE_FEE', false),
    gasPaymentMicrocredits: latestQuote.paymentMicrocredits,
  })
  if (result.kind !== 'aleo-hyperlane') throw new Error(`Unexpected execution kind: ${result.kind}`)
  console.log(`\nAleo ${asset} burn accepted:`, result.transactionId)
  console.log(`A Hyperlane relayer will deliver the message and release ${asset} to the ${config.destination} recipient.`)
}
