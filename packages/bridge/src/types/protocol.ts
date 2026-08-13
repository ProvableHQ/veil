/** Identifies the protocol that carries a bridge transfer. */
export type BridgeProtocol = 'xreserve' | 'hyperlane'

/** Identifies the deployment environment selected by a bridge client. */
export type BridgeEnvironment = 'mainnet' | 'testnet'

/** Identifies the transaction model used by a chain. */
export type BridgeChainFamily = 'aleo' | 'evm' | 'solana'

/**
 * Describes a chain known to the protocol bridge registry.
 *
 * @property id Stable SDK identifier used by assets and routes.
 * @property displayName Human-readable chain name.
 * @property family Transaction model used to prepare transfer steps.
 * @property environment Deployment environment containing the chain.
 * @property nativeCurrencySymbol Symbol used to pay transaction fees.
 * @property protocolDomains Protocol-specific domain identifiers when known.
 */
export type ProtocolBridgeChain = {
  id: string
  displayName: string
  family: BridgeChainFamily
  environment: BridgeEnvironment
  nativeCurrencySymbol: string
  protocolDomains?: Partial<Record<BridgeProtocol, string | number>> | undefined
}

/** Identifies how an asset exists on its chain. */
export type BridgeAssetKind = 'native' | 'token'

/**
 * Locates a token on its chain.
 *
 * @property kind Namespace containing the identifier.
 * @property value Contract, program, mint, or native-denom identifier.
 * @property tokenId Optional token identifier within a shared token program.
 */
export type BridgeAssetLocator = {
  kind: 'aleo-program' | 'evm-contract' | 'solana-mint' | 'native'
  value: string
  tokenId?: string | undefined
}

/**
 * Describes one chain-specific representation of a bridgeable asset.
 *
 * @property id Stable registry identifier, scoped to one chain.
 * @property chainId Chain carrying this representation.
 * @property symbol Display symbol.
 * @property name Human-readable asset name.
 * @property decimals Number of decimal places accepted in display amounts.
 * @property kind Whether the representation is native currency or a token.
 * @property locator Onchain identifier when the deployment is known.
 * @property addressValidationRegex Optional recipient validation expression.
 */
export type ProtocolBridgeAsset = {
  id: string
  chainId: string
  symbol: string
  name: string
  decimals: number
  kind: BridgeAssetKind
  locator?: BridgeAssetLocator | undefined
  addressValidationRegex?: string | undefined
}

/** Reports whether a route has enough reviewed metadata for execution. */
export type BridgeRouteAvailability = 'active' | 'metadata-required' | 'disabled'

/**
 * Describes one directional protocol route.
 *
 * @property id Stable route identifier.
 * @property protocol Protocol responsible for delivery.
 * @property environment Deployment environment containing both endpoints.
 * @property sourceAssetId Registry id of the debited asset.
 * @property destinationAssetId Registry id of the delivered asset.
 * @property availability Readiness for transaction execution.
 * @property deploymentId Upstream protocol deployment identifier when known.
 * @property source Reference used to audit the route metadata.
 * @property metadata Protocol-specific non-secret configuration.
 */
export type ProtocolBridgeRoute = {
  id: string
  protocol: BridgeProtocol
  environment: BridgeEnvironment
  sourceAssetId: string
  destinationAssetId: string
  availability: BridgeRouteAvailability
  deploymentId?: string | undefined
  source?: string | undefined
  metadata?: Readonly<Record<string, string | number | boolean>> | undefined
}

/**
 * Stores reviewed bridge chains, assets, and directional routes.
 *
 * @property version Caller-visible version used to pin and audit configuration.
 * @property chains Chain metadata referenced by assets.
 * @property assets Chain-specific assets referenced by routes.
 * @property routes Directional protocol routes.
 * @property sources Upstream registries and documentation used to build the snapshot.
 */
export type BridgeRegistry = {
  version: string
  chains: readonly ProtocolBridgeChain[]
  assets: readonly ProtocolBridgeAsset[]
  routes: readonly ProtocolBridgeRoute[]
  sources?: readonly string[] | undefined
}

/** Identifies the signer or service responsible for a transfer step. */
export type BridgeStepExecutor = 'aleo-wallet' | 'evm-wallet' | 'solana-wallet' | 'protocol'

/** Identifies a resumable operation in a protocol transfer. */
export type BridgeExecutionStepKind =
  | 'approve'
  | 'deposit'
  | 'burn'
  | 'dispatch'
  | 'wait-attestation'
  | 'mint'
  | 'withdraw'
  | 'wait-delivery'
  | 'confirm-delivery'

/**
 * Describes one ordered operation in a prepared transfer.
 *
 * @property key Stable step key within the plan.
 * @property kind Operation the executor performs.
 * @property chainId Chain on which the operation occurs, when applicable.
 * @property executor Wallet or protocol service responsible for the operation.
 * @property description Human-readable consequence of the step.
 * @property irreversible Whether submitting the step commits funds to the protocol flow.
 */
export type BridgeExecutionStep = {
  key: string
  kind: BridgeExecutionStepKind
  chainId?: string | undefined
  executor: BridgeStepExecutor
  description: string
  irreversible: boolean
}

/**
 * Describes a fee associated with a transfer plan.
 *
 * @property kind Fee category.
 * @property chainId Chain charging the fee.
 * @property assetId Asset used to pay the fee when known.
 * @property amount Decimal fee amount when available.
 * @property estimated Whether the amount can change before submission.
 */
export type BridgeFee = {
  kind: 'network' | 'protocol' | 'relayer'
  chainId: string
  assetId?: string | undefined
  amount?: string | undefined
  estimated: boolean
}

/** Identifies how much live protocol information a transfer quote contains. */
export type BridgeQuoteStatus = 'not-queried' | 'estimated' | 'confirmed'

/** Selects the Aleo destination transition used for an xReserve mint. */
export type AleoMintMode = 'public' | 'record' | 'private'

/**
 * Captures protocol fees and expected delivery for a directional route.
 *
 * @property routeId Directional route the quote prices.
 * @property protocol Protocol responsible for delivery.
 * @property amountIn Decimal source amount.
 * @property amountOut Expected decimal destination amount after known fees.
 * @property fees Network, protocol, and relayer fee components.
 * @property status Whether protocol endpoints have supplied live values.
 * @property expiresAt Expiration time for protocol-bound fee data when present.
 */
export type BridgeTransferQuote = {
  routeId: string
  protocol: BridgeProtocol
  amountIn: string
  amountOut?: string | undefined
  fees: BridgeFee[]
  status: BridgeQuoteStatus
  expiresAt?: string | undefined
}

/**
 * Parameters for preparing a protocol bridge transfer.
 *
 * @property routeId Directional route selected from `getRoutes`.
 * @property amount Decimal source amount in display units.
 * @property recipient Destination-chain recipient.
 * @property sender Optional source-chain sender used by future fee and approval planning.
 * @property mintMode Aleo mint transition selected for xReserve delivery. Defaults to `public`.
 * @property privateRecipient Deprecated alias for `mintMode: 'private'`. Defaults to false.
 */
export type PrepareTransferParameters = {
  routeId: string
  amount: string
  recipient: string
  sender?: string | undefined
  mintMode?: AleoMintMode | undefined
  /** @deprecated Use `mintMode: 'private'`; retained for compatibility through the next major release. */
  privateRecipient?: boolean | undefined
}

/**
 * Captures a locally prepared, non-fund-moving bridge transfer.
 *
 * @property registryVersion Registry snapshot used to build the plan.
 * @property protocol Protocol responsible for delivery.
 * @property route Directional route selected by the caller.
 * @property sourceAsset Asset debited by the source transaction.
 * @property destinationAsset Asset delivered on the destination chain.
 * @property amountIn Decimal source amount.
 * @property amountOut Expected decimal destination amount when determinable without a live fee query.
 * @property recipient Destination-chain recipient.
 * @property sender Optional source-chain sender.
 * @property mintMode Aleo destination transition selected by the caller.
 * @property privateRecipient Whether the destination requests private Aleo delivery.
 * @property fees Known fee categories; amounts remain absent until protocol quoting is implemented.
 * @property steps Ordered operations required to complete the transfer.
 */
export type BridgeTransferPlan = {
  registryVersion: string
  protocol: BridgeProtocol
  route: ProtocolBridgeRoute
  sourceAsset: ProtocolBridgeAsset
  destinationAsset: ProtocolBridgeAsset
  amountIn: string
  amountOut?: string | undefined
  recipient: string
  sender?: string | undefined
  mintMode: AleoMintMode
  privateRecipient: boolean
  quote: BridgeTransferQuote
  fees: BridgeFee[]
  steps: BridgeExecutionStep[]
}

/** Identifies the normalized lifecycle state of a protocol transfer. */
export type BridgeTransferStatus =
  | 'PREPARED'
  | 'SOURCE_APPROVAL_PENDING'
  | 'SOURCE_SUBMISSION_PENDING'
  | 'SOURCE_CONFIRMING'
  | 'ATTESTATION_PENDING'
  | 'DELIVERY_PENDING'
  | 'DESTINATION_CONFIRMING'
  | 'COMPLETED'
  | 'FAILED'
  | 'EXPIRED'

/**
 * Captures protocol-neutral transfer progress and protocol-native state.
 *
 * @property id Stable transfer or message identifier.
 * @property protocol Protocol responsible for delivery.
 * @property status Normalized lifecycle state.
 * @property sourceTxId Source-chain transaction identifier when submitted.
 * @property destinationTxId Destination-chain transaction identifier when submitted.
 * @property messageId Hyperlane message identifier when applicable.
 * @property protocolState Protocol-native progress fields retained for diagnostics and resumption.
 */
export type BridgeTransferReceipt = {
  id: string
  protocol: BridgeProtocol
  status: BridgeTransferStatus
  sourceTxId?: string | undefined
  destinationTxId?: string | undefined
  messageId?: string | undefined
  protocolState: Readonly<Record<string, unknown>>
}
