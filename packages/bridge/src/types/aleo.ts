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
    inputs: string[]
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
