import { writeContract, type WriteContractParameters, type WriteContractReturnType } from '../../actions/wallet/writeContract.js'
import { simulateContract, type SimulateContractParameters, type SimulateContractReturnType } from '../../actions/wallet/simulateContract.js'
import { deployContract, type DeployContractParameters, type DeployContractReturnType } from '../../actions/wallet/deployContract.js'
import { sendTransaction, type SendTransactionParameters, type SendTransactionReturnType } from '../../actions/wallet/sendTransaction.js'
import { signMessage, type SignMessageParameters, type SignMessageReturnType } from '../../actions/wallet/signMessage.js'
import { transfer, type TransferParameters, type TransferReturnType } from '../../actions/wallet/transfer.js'
import { decrypt, type DecryptParameters, type DecryptReturnType } from '../../actions/wallet/decrypt.js'
import { requestRecords, type RequestRecordsParameters, type RequestRecordsReturnType } from '../../actions/wallet/requestRecords.js'
import type { Client } from '../createClient.js'

export type WalletActions = {
  sendTransaction: (params: SendTransactionParameters) => Promise<SendTransactionReturnType>
  writeContract: (params: WriteContractParameters) => Promise<WriteContractReturnType>
  /** Alias for writeContract — consistent with Aleo wallet adapter terminology */
  executeTransaction: (params: WriteContractParameters) => Promise<WriteContractReturnType>
  /** Execute locally and return outputs without broadcasting */
  simulateContract: (params: SimulateContractParameters) => Promise<SimulateContractReturnType>
  deployContract: (params: DeployContractParameters) => Promise<DeployContractReturnType>
  signMessage: (params: SignMessageParameters) => Promise<SignMessageReturnType>
  transfer: (params: TransferParameters) => Promise<TransferReturnType>
  decrypt: (params: DecryptParameters) => Promise<DecryptReturnType>
  requestRecords: (params: RequestRecordsParameters) => Promise<RequestRecordsReturnType>
}

export function walletActions(client: Client): WalletActions {
  return {
    sendTransaction: (params) => sendTransaction(client, params),
    writeContract: (params) => writeContract(client, params),
    executeTransaction: (params) => writeContract(client, params),
    simulateContract: (params) => simulateContract(client, params),
    deployContract: (params) => deployContract(client, params),
    signMessage: (params) => signMessage(client, params),
    transfer: (params) => transfer(client, params),
    decrypt: (params) => decrypt(client, params),
    requestRecords: (params) => requestRecords(client, params),
  }
}
