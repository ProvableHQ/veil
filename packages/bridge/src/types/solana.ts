import type { BridgeTransferPlan, BridgeTransferReceipt } from './protocol.js'

/**
 * Sends a Solana JSON-RPC POST request without coupling the bridge client to a runtime global.
 *
 * Matches the subset of the Fetch API needed for JSON-RPC calls, so
 * `globalThis.fetch` satisfies this type without an adapter.
 */
export type SolanaRpcHttpTransport = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

/**
 * Configures the Solana JSON-RPC endpoint used for reads such as blockhash and
 * transaction-confirmation lookups.
 *
 * @property url Solana JSON-RPC HTTP endpoint.
 * @property transport Optional fetch-compatible transport used for RPC requests. Defaults to `globalThis.fetch`.
 */
export type SolanaRpcConfig = {
  url: string
  transport?: SolanaRpcHttpTransport | undefined
}

/**
 * Captures the reviewed metadata required to dispatch a Solana Hyperlane Warp Route transfer.
 *
 * @property warpProgramAddress Deployed Solana Warp Route program handling the transfer instruction.
 * @property tokenPda Program-derived address holding the route's token configuration.
 * @property nativeCollateralPda Program-derived address holding locked native SOL collateral.
 * @property dispatchAuthorityPda Program-derived address authorizing Mailbox dispatch on behalf of the Warp Route.
 * @property mailboxProgramAddress Solana Hyperlane Mailbox program used by the reviewed deployment.
 * @property mailboxOutboxPda Program-derived address holding the Mailbox's outbox state.
 * @property igpProgramAddress Solana interchain gas paymaster program used by the reviewed deployment.
 * @property igpProgramDataPda Program-derived address holding the gas paymaster's program data.
 * @property igpAccount Terminal gas-oracle account actually debited for destination delivery; read
 * directly off the token's configuration when the route points at a plain IGP, or off the configured
 * `igpOverheadAccount`'s own `inner` field when the route wraps its IGP in an `OverheadIgp`.
 * @property igpOverheadAccount Optional `OverheadIgp` wrapper account configured as the token's gas
 * paymaster. Present only when the reviewed deployment wraps its IGP in an `OverheadIgp` layer;
 * `buildTransferRemoteInstruction` appends it ahead of `igpAccount` when set, and omits it otherwise.
 * @property splNoopProgramAddress SPL no-op program used to emit Hyperlane message logs.
 * @property destinationDomain Hyperlane domain passed to the transfer instruction.
 * @property destinationGasAmount Destination gas amount quoted for delivery, as a base-10 string.
 * @property registryCommit Hyperlane Registry commit containing the deployment snapshot.
 * @property solanaReviewedAt ISO 8601 timestamp of the last manual review of this deployment.
 * @property solanaConfigSource Identifies where the reviewed configuration values were sourced from.
 */
export type SolanaHyperlaneRouteMetadata = {
  warpProgramAddress: string
  tokenPda: string
  nativeCollateralPda: string
  dispatchAuthorityPda: string
  mailboxProgramAddress: string
  mailboxOutboxPda: string
  igpProgramAddress: string
  igpProgramDataPda: string
  igpAccount: string
  igpOverheadAccount?: string | undefined
  splNoopProgramAddress: string
  destinationDomain: number
  destinationGasAmount: string
  registryCommit: string
  solanaReviewedAt: string
  solanaConfigSource: string
}

/**
 * Selects a prepared Solana Hyperlane transfer for live fee quoting.
 *
 * @property plan Pure transfer plan returned by `prepareTransfer`.
 */
export type QuoteSolanaHyperlaneTransferParameters = {
  plan: BridgeTransferPlan
}

/**
 * Captures one live fee quote for a Solana-to-Aleo Hyperlane transfer.
 *
 * All amounts are denominated in lamports.
 *
 * @property routeId Route the quote applies to.
 * @property amountLamports Amount to be transferred, in lamports.
 * @property igpPaymentLamports Interchain gas paymaster payment required for destination delivery, in lamports.
 * @property networkFeeLamports Solana network fee estimated for the transaction, in lamports.
 * @property totalLamports Sum of the amount, gas payment, and network fee, in lamports.
 */
export type SolanaHyperlaneTransferQuote = {
  routeId: string
  amountLamports: bigint
  igpPaymentLamports: bigint
  networkFeeLamports: bigint
  totalLamports: bigint
}

/**
 * Configures submission of a Solana Hyperlane transfer.
 *
 * The action signs and sends the transaction through the connection's Solana
 * wallet client, then polls its public client for confirmation.
 *
 * @property plan Pure transfer plan returned by `prepareTransfer`.
 * @property pollingIntervalMs Delay between confirmation checks. Defaults to 1,000 milliseconds; floored at 100 milliseconds so a small or zero value cannot busy-poll the RPC endpoint.
 * @property confirmationTimeoutMs Maximum time to wait for confirmation. Defaults to 120,000 milliseconds; a timeout returns resumable pending state.
 * @property resume Previously checkpointed receipt. When supplied, the action
 *   verifies the existing signature without signing or broadcasting again.
 * @property onSubmitted Durable checkpoint hook called immediately after broadcast
 *   and before confirmation polling begins.
 */
export type ExecuteSolanaHyperlaneTransferParameters = {
  plan: BridgeTransferPlan
  pollingIntervalMs?: number | undefined
  confirmationTimeoutMs?: number | undefined
  resume?: BridgeTransferReceipt | undefined
  onSubmitted?: ((receipt: BridgeTransferReceipt) => void | Promise<void>) | undefined
}

/**
 * Captures the resumable Hyperlane progress after a Solana transfer is submitted.
 *
 * @property receipt Protocol-neutral transfer state, including the source signature and message id when confirmed.
 */
export type SolanaHyperlaneTransferExecution = {
  receipt: BridgeTransferReceipt
}
