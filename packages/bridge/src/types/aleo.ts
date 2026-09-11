import type { ProvingProgressHandler, Transaction, TransactionInput, WalletClient } from '@provablehq/veil-core'
import type { BridgeEndpoint, BridgePlan, BridgeReceipt } from './protocol.js'
import type { XReserveAttestationResult } from './xreserve.js'

/**
 * Submits one Aleo program execution through an application-provided wallet client.
 *
 * The required method is available on Veil wallet clients and connected Aleo
 * wallet adapters.
 *
 * @property executeTransaction Prompts the wallet to prove, sign, and broadcast a program call.
 */
export type AleoWalletClient = Pick<WalletClient, 'executeTransaction'>

/**
 * Controls conversion of a public Aleo token balance into a private record.
 *
 * @property asset Aleo chain and token selected for the private conversion. The token MUST support shielding.
 * @property amount Positive decimal amount in the asset's display units.
 * @property recipient Optional Aleo recipient for ARC-22 assets. Defaults to the active wallet address.
 * @property privateFee Whether the Aleo wallet pays its fee privately. Defaults to false.
 * @property onProgress Optional awaited callback for proving and submission boundaries.
 * @property onPrepared Optional awaited callback receiving the proved transaction before broadcast.
 */
export type ShieldParameters = {
  asset: BridgeEndpoint
  amount: string
  recipient?: string | undefined
  privateFee?: boolean | undefined
  onProgress?: ProvingProgressHandler | undefined
  onPrepared?: ((transaction: Transaction) => void | Promise<void>) | undefined
}

/**
 * Controls conversion of an Aleo private record into a public token balance.
 *
 * @property asset Aleo chain and token selected for the public conversion. The token MUST support unshielding.
 * @property amount Positive decimal amount in the asset's display units.
 * @property record Optional encoded `Token` record or wallet record request. Defaults to wallet selection by minimum amount.
 * @property recipient Optional Aleo public recipient for ARC-22 assets. Defaults to the active wallet address.
 * @property merkleProof Optional ARC-22 freeze-list proof literal. Defaults to the canonical empty-tree proof pair.
 * @property privateFee Whether the Aleo wallet pays its fee privately. Defaults to false.
 * @property onProgress Optional awaited callback for proving and submission boundaries.
 * @property onPrepared Optional awaited callback receiving the proved transaction before broadcast.
 */
export type UnshieldParameters = {
  asset: BridgeEndpoint
  amount: string
  record?: TransactionInput | undefined
  recipient?: string | undefined
  merkleProof?: string | undefined
  privateFee?: boolean | undefined
  onProgress?: ProvingProgressHandler | undefined
  onPrepared?: ((transaction: Transaction) => void | Promise<void>) | undefined
}

/**
 * Captures a submitted Aleo public/private asset conversion.
 *
 * @property transactionId Aleo transaction id returned by the wallet.
 * @property assetId Chain-scoped asset identifier converted by the transaction.
 * @property amount Original decimal amount supplied by the caller.
 * @property amountAtomic Exact amount submitted as a u128 atomic value.
 */
export type AleoPrivacyExecution = {
  transactionId: string
  assetId: string
  amount: string
  amountAtomic: bigint
}

/**
 * Configures submission of the user-authorized USDCx wrapper mint.
 *
 * @property plan Original private-mint transfer plan.
 * @property privateMintSecretNonce Secret Aleo scalar committed by the source deposit. Defaults to `0scalar`.
 * @property deposit Confirmed EVM deposit receipt carrying the canonical payload.
 * @property attestation Completed Circle payload and signature response.
 * @property privateFee Whether the Aleo wallet should pay its fee privately. Defaults to false.
 * @property onSubmitted Durable checkpoint hook called immediately after the wallet returns a transaction id.
 * @property onProgress Optional awaited callback for Aleo proving and submission boundaries.
 * @property onPrepared Durable callback invoked with a fully proved transaction before network broadcast.
 */
export type ExecuteXReservePrivateMintParameters = {
  plan: BridgePlan
  privateMintSecretNonce?: string | undefined
  deposit: BridgeReceipt
  attestation: XReserveAttestationResult
  privateFee?: boolean | undefined
  onSubmitted?: ((receipt: BridgeReceipt) => void | Promise<void>) | undefined
  onProgress?: ProvingProgressHandler | undefined
  onPrepared?: ((transaction: Transaction) => void | Promise<void>) | undefined
}

/**
 * Captures the submitted wrapper transaction and resumable destination state.
 *
 * @property transactionId Aleo transaction id returned by the connected wallet.
 * @property receipt Transfer state retaining source, Circle, and destination identifiers.
 */
export type XReservePrivateMintExecution = {
  transactionId: string
  receipt: BridgeReceipt
}

/** Selects which deployed USDCx burn transition the Aleo wallet calls. */
export type XReserveBurnMode = 'private' | 'public' | 'public-as-signer'

/**
 * Describes one validated Aleo USDCx burn call without submitting it.
 *
 * @property routeId Aleo-to-Ethereum xReserve route used for the burn.
 * @property mode Transition variant selected by the caller.
 * @property program Deployed bridge or wrapper program receiving the transaction.
 * @property function Exact burn transition invoked by the wallet.
 * @property inputs Ordered Aleo literals and wallet record requests.
 * @property amountAtomic Burn amount in USDCx base units.
 * @property nativeDomain Circle Ethereum destination domain, fixed to 0.
 * @property nativeRecipientBytes32 Ethereum recipient left-padded to 32 bytes.
 */
export type XReserveBurnCall = {
  routeId: string
  mode: XReserveBurnMode
  program: string
  function: 'burn_public_as_signer' | 'burn_public' | 'private_burn'
  inputs: TransactionInput[]
  amountAtomic: bigint
  nativeDomain: number
  nativeRecipientBytes32: `0x${string}`
}

/**
 * Configures an Aleo USDCx burn destined for Ethereum USDC.
 *
 * @property plan Aleo-to-Ethereum plan returned by `prepare`.
 * @property mode Burn transition to submit. Defaults to `private`.
 * @property userRecord Wallet record request or encoded USDCx token record. Required only for `private`.
 * @property merkleProof Encoded `[MerkleProof; 2]` Aleo literal. Required only for `private`.
 * @property privateFee Whether the Aleo wallet should pay its fee privately. Defaults to false.
 * @property onSubmitted Durable checkpoint hook called immediately after the wallet returns a transaction id.
 * @property onProgress Optional awaited callback for Aleo proving and submission boundaries.
 * @property onPrepared Durable callback invoked with a fully proved transaction before network broadcast.
 */
export type ExecuteXReserveBurnParameters = {
  plan: BridgePlan
  mode?: XReserveBurnMode | undefined
  userRecord?: TransactionInput | undefined
  merkleProof?: string | undefined
  privateFee?: boolean | undefined
  onSubmitted?: ((receipt: BridgeReceipt) => void | Promise<void>) | undefined
  onProgress?: ProvingProgressHandler | undefined
  onPrepared?: ((transaction: Transaction) => void | Promise<void>) | undefined
}

/**
 * Captures the submitted Aleo burn and the service-managed delivery state.
 *
 * @property transactionId Aleo transaction id returned by the connected wallet.
 * @property receipt Transfer state retained while the Aleo attestation service forwards the burn to Circle.
 */
export type XReserveBurnExecution = {
  transactionId: string
  receipt: BridgeReceipt
}

/**
 * Configures one live Hyperlane hook gas payment quote.
 *
 * @property routeId Aleo-origin Hyperlane route whose destination gas is quoted.
 */
export type QuoteAleoHyperlaneGasPaymentParameters = {
  routeId: string
}

/**
 * Captures one live destination gas quote for an Aleo-origin Hyperlane transfer.
 *
 * The on-chain hook asserts that the paid amount exactly equals the quote it
 * recomputes at finalization, so the caller should quote shortly before submission.
 *
 * @property routeId Route the quote applies to.
 * @property gasLimit Destination gas limit charged by the route, after the on-chain 50000 zero-limit fallback.
 * @property gasOverhead Destination gas overhead added by the interchain gas paymaster.
 * @property gasPrice Destination gas price reported by the on-chain oracle.
 * @property exchangeRate Destination-to-Aleo exchange rate reported by the on-chain oracle.
 * @property paymentMicrocredits Exact hook payment in microcredits (u64) the transfer must allow.
 * @property executionFeeMicrocredits Always `null`; calculating the Aleo execution fee requires building an account-authorized execution.
 * @property totalMicrocredits Always `null` until an execution fee is available. The hook payment alone is not the sender's total cost.
 */
export type AleoHyperlaneGasQuote = {
  routeId: string
  gasLimit: bigint
  gasOverhead: bigint
  gasPrice: bigint
  exchangeRate: bigint
  paymentMicrocredits: bigint
  executionFeeMicrocredits: null
  totalMicrocredits: null
}

/**
 * Describes one locally constructed Aleo Hyperlane transfer call.
 *
 * @property routeId Directional Hyperlane route used to construct the call.
 * @property program Aleo Warp Route program receiving the transaction.
 * @property function Exact Warp Route transition invoked by the wallet.
 * @property inputs Seven ordered Aleo literals expected by the selected transfer transition.
 * @property amountAtomic Source amount expressed in the Aleo token's base units.
 * @property usesPlaceholderConfiguration Whether unresolved deployment values make the call unsafe to submit.
 * @property placeholderFields Registry fields that must be replaced before submission is enabled.
 */
export type AleoHyperlaneTransferRemoteCall = {
  routeId: string
  program: string
  function: 'transfer_remote' | 'transfer_remote_as_signer'
  inputs: TransactionInput[]
  amountAtomic: bigint
  usesPlaceholderConfiguration: boolean
  placeholderFields: readonly string[]
}

/**
 * Configures construction or submission of an Aleo Hyperlane withdrawal.
 *
 * @property plan Aleo-origin Hyperlane plan returned by `prepare`.
 * @property mode Whether the program burns from `self.caller` or the EOA-bound `self.signer`. Defaults to `caller`.
 * @property privateFee Whether the Aleo wallet should pay its fee privately. Defaults to false.
 * @property gasPaymentMicrocredits Live hook payment in microcredits (u64) from `quote`. Optional for inspection-only call construction; required by the route-specific execution implementation.
 * @property onSubmitted Durable checkpoint hook called immediately after the wallet
 *   returns a transaction id.
 * @property onProgress Optional awaited callback for Aleo proving and submission boundaries.
 * @property onPrepared Durable callback invoked with a fully proved transaction before network broadcast.
 */
export type ExecuteAleoHyperlaneTransferRemoteParameters = {
  plan: BridgePlan
  mode?: 'caller' | 'signer' | undefined
  privateFee?: boolean | undefined
  gasPaymentMicrocredits?: bigint | undefined
  onSubmitted?: ((receipt: BridgeReceipt) => void | Promise<void>) | undefined
  onProgress?: ProvingProgressHandler | undefined
  onPrepared?: ((transaction: Transaction) => void | Promise<void>) | undefined
}

/**
 * Captures a submitted Aleo Hyperlane dispatch.
 *
 * @property transactionId Aleo transaction id returned by the connected wallet.
 * @property receipt Resumable receipt awaiting Hyperlane delivery.
 */
export type AleoHyperlaneTransferRemoteExecution = {
  transactionId: string
  receipt: BridgeReceipt
}
