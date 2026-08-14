import type { TransactionInput } from '@provablehq/veil-core'
import type { BridgeTransferPlan, BridgeTransferReceipt } from './protocol.js'
import type { XReserveAttestationResult } from './xreserve.js'

/**
 * Submits one Aleo program execution through an application-provided wallet client.
 *
 * The shape is compatible with Veil wallet clients and connected Aleo wallet adapters.
 *
 * @property executeTransaction Prompts the wallet to prove, sign, and broadcast a program call.
 */
export type AleoBridgeExecutor = {
  executeTransaction: (params: {
    program: string
    function: string
    inputs: TransactionInput[]
    privateFee?: boolean | undefined
    imports?: string[] | undefined
  }) => Promise<string | { transactionId: string }>
}

/**
 * Configures submission of the user-authorized USDCx wrapper mint.
 *
 * @property plan Original private-mint transfer plan.
 * @property deposit Confirmed EVM deposit receipt carrying the canonical payload.
 * @property attestation Completed Circle payload and signature response.
 * @property privateFee Whether the Aleo wallet should pay its fee privately. Defaults to false.
 */
export type ExecuteXReservePrivateMintParameters = {
  plan: BridgeTransferPlan
  deposit: BridgeTransferReceipt
  attestation: XReserveAttestationResult
  privateFee?: boolean | undefined
}

/**
 * Captures the submitted wrapper transaction and resumable destination state.
 *
 * @property transactionId Aleo transaction id returned by the connected wallet.
 * @property receipt Transfer state retaining source, Circle, and destination identifiers.
 */
export type XReservePrivateMintExecution = {
  transactionId: string
  receipt: BridgeTransferReceipt
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
 * @property plan Aleo-to-Ethereum plan returned by `prepareTransfer`.
 * @property mode Burn transition to submit. Defaults to `private`.
 * @property userRecord Wallet record request or encoded USDCx token record. Required only for `private`.
 * @property merkleProof Encoded `[MerkleProof; 2]` Aleo literal. Required only for `private`.
 * @property privateFee Whether the Aleo wallet should pay its fee privately. Defaults to false.
 */
export type ExecuteXReserveBurnParameters = {
  plan: BridgeTransferPlan
  mode?: XReserveBurnMode | undefined
  userRecord?: TransactionInput | undefined
  merkleProof?: string | undefined
  privateFee?: boolean | undefined
}

/**
 * Captures the submitted Aleo burn and the service-managed delivery state.
 *
 * @property transactionId Aleo transaction id returned by the connected wallet.
 * @property receipt Transfer state retained while the Aleo attestation service forwards the burn to Circle.
 */
export type XReserveBurnExecution = {
  transactionId: string
  receipt: BridgeTransferReceipt
}
