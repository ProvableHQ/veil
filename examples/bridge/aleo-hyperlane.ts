import {
  createBridgeClient,
  DEFAULT_BRIDGE_REGISTRY,
  type AleoBridgeExecutor,
  type BridgeRegistry,
  type ProtocolBridgeRoute,
} from '@provablehq/veil-aleo-bridges'

const HOOK_MANAGER_PROGRAM = 'hyp_hook_manager.aleo'
const EXECUTION_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_MOVES_REAL_FUNDS'
const ALEO_PROVING_PROGRESS_INTERVAL_MS = 15_000
const MAX_U64 = (1n << 64n) - 1n

type AleoHyperlaneAsset = 'ETH' | 'WBTC'
type AssetConfiguration = {
  symbol: AleoHyperlaneAsset
  routeId: string
  balanceProgram: string
  decimals: number
  amountEnvironmentVariable: string
  executionEnvironmentVariable: string
}

const ASSETS: Record<AleoHyperlaneAsset, AssetConfiguration> = {
  ETH: {
    symbol: 'ETH',
    routeId: 'hyperlane:aleo/eth->ethereum/eth',
    balanceProgram: 'arc20_eth.aleo',
    decimals: 18,
    amountEnvironmentVariable: 'ETH_AMOUNT',
    executionEnvironmentVariable: 'EXECUTE_HYPERLANE_ETH_RETURN',
  },
  WBTC: {
    symbol: 'WBTC',
    routeId: 'hyperlane:aleo/wbtc->ethereum/wbtc',
    balanceProgram: 'arc20_wbtc.aleo',
    decimals: 8,
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

function routeMetadata(routeId: string): Readonly<Record<string, string | number | boolean>> {
  const route = DEFAULT_BRIDGE_REGISTRY.routes.find((entry) => entry.id === routeId)
  if (!route?.metadata) throw new Error(`Missing route metadata: ${routeId}`)
  return route.metadata
}

function metadataString(
  metadata: Readonly<Record<string, string | number | boolean>>,
  routeId: string,
  name: string,
): string {
  const value = metadata[name]
  if (typeof value !== 'string' || !value) throw new Error(`Missing ${name} in ${routeId}`)
  return value
}

function metadataNumber(
  metadata: Readonly<Record<string, string | number | boolean>>,
  routeId: string,
  name: string,
): number {
  const value = metadata[name]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${name} in ${routeId}`)
  }
  return value
}

type GasConfiguration = {
  gas_overhead: bigint
  exchange_rate: bigint
  gas_price: bigint
}

function parseGasConfiguration(literal: unknown): GasConfiguration {
  if (typeof literal !== 'string') throw new Error('Hyperlane gas configuration must be an Aleo struct literal')
  const read = (field: keyof GasConfiguration): bigint => {
    const match = new RegExp(`${field}:\\s*(0|[1-9][0-9]*)u128`).exec(literal)
    if (!match) throw new Error(`Hyperlane gas configuration is missing ${field}`)
    return BigInt(match[1]!)
  }
  return {
    gas_overhead: read('gas_overhead'),
    exchange_rate: read('exchange_rate'),
    gas_price: read('gas_price'),
  }
}

async function quoteHookCredits(networkUrl: string, routeId: string): Promise<bigint> {
  const metadata = routeMetadata(routeId)
  const hook = metadataString(metadata, routeId, 'aleoMailboxDefaultHook')
  const destination = metadataNumber(metadata, routeId, 'aleoDestinationDomain')
  const gasLimit = BigInt(metadataString(metadata, routeId, 'aleoRemoteRouterGas'))
  const mappingKey = `{ igp: ${hook}, destination: ${destination}u32 }`
  const url = `${networkUrl.replace(/\/$/, '')}/mainnet/program/${HOOK_MANAGER_PROGRAM}/mapping/destination_gas_configs/${encodeURIComponent(mappingKey)}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Hyperlane gas quote failed with HTTP ${response.status}`)
  const config = parseGasConfiguration(await response.json())
  const quote = ((gasLimit + config.gas_overhead) * config.gas_price * config.exchange_rate) / 10_000_000_000n
  if (quote <= 0n || quote > MAX_U64) throw new Error(`Hyperlane hook quote does not fit a positive u64: ${quote}`)
  return quote
}

function executionRegistry(routeId: string, hookCredits: bigint): BridgeRegistry {
  const routes = DEFAULT_BRIDGE_REGISTRY.routes.map((route): ProtocolBridgeRoute => {
    if (route.id !== routeId) return route
    return {
      ...route,
      availability: 'active',
      metadata: {
        ...route.metadata,
        aleoAllowanceAmount0: hookCredits.toString(),
        aleoPlaceholderConfiguration: false,
      },
    }
  })
  return { ...DEFAULT_BRIDGE_REGISTRY, routes }
}

/**
 * Quotes or submits one reviewed Aleo-to-Ethereum Hyperlane route.
 *
 * Reads a public ARC-20 balance and the live IGP gas configuration without a
 * record scanner. Execution requotes the hook payment and burns through the
 * signer-bound Warp Route transition.
 *
 * @param asset Aleo-origin asset whose Ethereum return journey runs.
 * @returns A promise that resolves after preflight or accepted Aleo submission.
 * @throws Error When route metadata, balances, the live gas quote, or execution fails.
 *
 * @example
 * await runAleoHyperlaneExample('ETH')
 */
export async function runAleoHyperlaneExample(asset: AleoHyperlaneAsset): Promise<void> {
  const config = ASSETS[asset]
  const amount = requiredEnvironmentVariable(config.amountEnvironmentVariable)
  const recipient = requiredEnvironmentVariable('ETHEREUM_RECIPIENT')
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

  const defaultBridge = createBridgeClient({ environment: 'mainnet' })
  const previewPlan = defaultBridge.prepareTransfer({ routeId: config.routeId, amount, recipient })
  const previewCall = defaultBridge.buildAleoHyperlaneTransferRemoteCall({ plan: previewPlan, mode: 'signer' })
  if (previewCall.placeholderFields.length !== 1 || previewCall.placeholderFields[0] !== 'aleoAllowanceAmount0') {
    throw new Error(`${asset} return route has unresolved fields: ${previewCall.placeholderFields.join(', ') || 'unknown'}`)
  }

  const { loadNetwork } = await import('@provablehq/veil-aleo-sdk')
  const aleo = await loadNetwork('mainnet')
  const { publicClient, walletClient, account } = aleo.createAleoClient({
    privateKey,
    networkUrl,
    provingMode,
    ...(process.env.ALEO_PROVER_URL?.trim() ? { proverUrl: process.env.ALEO_PROVER_URL.trim() } : {}),
    ...(consumerId && apiKey ? { consumerId, apiKey } : {}),
    useFeeMaster: booleanFromEnvironment('ALEO_USE_FEE_MASTER', true),
    confirmationTimeout: millisecondsFromEnvironment('ALEO_EXECUTION_CONFIRMATION_TIMEOUT_MS', 5 * 60_000),
  })
  const [assetLiteral, publicCredits, hookCredits] = await Promise.all([
    publicClient.readContract({ programId: config.balanceProgram, mapping: 'balances', key: account.address }),
    publicClient.getBalance({ address: account.address }),
    quoteHookCredits(networkUrl, config.routeId),
  ])
  const assetBalance = parseUnsignedLiteral(assetLiteral, 'u128')

  console.log(`Read-only Aleo ${asset} to Ethereum ${asset} preflight`)
  console.table({
    route: config.routeId,
    sender: account.address,
    recipient,
    amount: `${formatAmount(previewCall.amountAtomic, config.decimals)} ${asset}`,
    [`${asset.toLowerCase()}PublicBalance`]: `${formatAmount(assetBalance, config.decimals)} ${asset}`,
    publicCreditsBalance: `${formatAmount(publicCredits, 6)} credits`,
    hyperlaneHookPayment: `${formatAmount(hookCredits, 6)} credits`,
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

  const latestHookCredits = await quoteHookCredits(networkUrl, config.routeId)
  if (publicCredits < latestHookCredits) {
    throw new Error(`Insufficient public credits for the Hyperlane hook payment of ${latestHookCredits} microcredits`)
  }
  if (latestHookCredits !== hookCredits) {
    console.log(`Hyperlane hook quote changed from ${hookCredits} to ${latestHookCredits} microcredits; using the latest quote.`)
  }
  if (consumerId && apiKey) await walletClient.authenticateProvableApi()

  const executor: AleoBridgeExecutor = {
    executeTransaction: async ({ program, function: functionName, inputs, privateFee, imports }) => {
      if (imports?.length) throw new Error('The local bridge executor does not accept dynamic import names')
      const startedAt = Date.now()
      const progress = setInterval(() => {
        console.log(`Aleo proving is still in progress (${Math.round((Date.now() - startedAt) / 1_000)}s elapsed).`)
      }, ALEO_PROVING_PROGRESS_INTERVAL_MS)
      try {
        const result = await walletClient.executeContract({ program, function: functionName, inputs, privateFee })
        return result.transactionId
      } finally {
        clearInterval(progress)
      }
    },
  }
  const registry = executionRegistry(config.routeId, latestHookCredits)
  const bridge = createBridgeClient({ environment: 'mainnet', registry, executors: { aleo: executor } })
  const plan = bridge.prepareTransfer({ routeId: config.routeId, amount, recipient })
  const result = await bridge.executeAleoHyperlaneTransferRemote({
    plan,
    mode: 'signer',
    privateFee: booleanFromEnvironment('ALEO_PRIVATE_FEE', false),
  })
  console.log(`\nAleo ${asset} burn accepted:`, result.transactionId)
  console.log(`A Hyperlane relayer will deliver the message and release ${asset} to the Ethereum recipient.`)
}
