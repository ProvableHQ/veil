import { writeContract, type WriteContractParameters, type WriteContractReturnType } from '../../actions/wallet/writeContract.js'
import { deployContract, type DeployContractParameters, type DeployContractReturnType } from '../../actions/wallet/deployContract.js'
import { sendTransaction, type SendTransactionParameters, type SendTransactionReturnType } from '../../actions/wallet/sendTransaction.js'
import { signMessage, type SignMessageParameters, type SignMessageReturnType } from '../../actions/wallet/signMessage.js'
import { transfer, type TransferParameters, type TransferReturnType } from '../../actions/wallet/transfer.js'
import { decrypt, type DecryptParameters, type DecryptReturnType } from '../../actions/wallet/decrypt.js'
import { requestRecords, type RequestRecordsParameters, type RequestRecordsReturnType } from '../../actions/wallet/requestRecords.js'
import { transactionStatus, type TransactionStatusParameters, type TransactionStatusReturnType } from '../../actions/wallet/transactionStatus.js'
import { switchChain, type SwitchChainParameters, type SwitchChainReturnType } from '../../actions/wallet/switchChain.js'
import { requestTransactionHistory, type RequestTransactionHistoryParameters, type RequestTransactionHistoryReturnType } from '../../actions/wallet/requestTransactionHistory.js'
import { getChainId, type GetChainIdReturnType } from '../../actions/wallet/getChainId.js'
import type { Client } from '../createClient.js'

export type WalletActions = {
  sendTransaction: (params: SendTransactionParameters) => Promise<SendTransactionReturnType>
  writeContract: (params: WriteContractParameters) => Promise<WriteContractReturnType>
  /** Alias for writeContract — consistent with Aleo wallet adapter terminology */
  executeTransaction: (params: WriteContractParameters) => Promise<WriteContractReturnType>
  deployContract: (params: DeployContractParameters) => Promise<DeployContractReturnType>
  signMessage: (params: SignMessageParameters) => Promise<SignMessageReturnType>
  transfer: (params: TransferParameters) => Promise<TransferReturnType>
  decrypt: (params: DecryptParameters) => Promise<DecryptReturnType>
  requestRecords: (params: RequestRecordsParameters) => Promise<RequestRecordsReturnType>
  transactionStatus: (params: TransactionStatusParameters) => Promise<TransactionStatusReturnType>
  switchChain: (params: SwitchChainParameters) => Promise<SwitchChainReturnType>
  /** Alias for switchChain — matches Aleo wallet adapter terminology */
  switchNetwork: (params: SwitchChainParameters) => Promise<SwitchChainReturnType>
  requestTransactionHistory: (params: RequestTransactionHistoryParameters) => Promise<RequestTransactionHistoryReturnType>
  getChainId: () => Promise<GetChainIdReturnType>
  /** Alias for getChainId — matches Aleo terminology */
  getNetwork: () => Promise<GetChainIdReturnType>
}

export function walletActions(client: Client): WalletActions {
  return {
    sendTransaction: (params) => sendTransaction(client, params),
    writeContract: (params) => writeContract(client, params),
    executeTransaction: (params) => writeContract(client, params),
    deployContract: (params) => deployContract(client, params),
    signMessage: (params) => signMessage(client, params),
    transfer: (params) => transfer(client, params),
    decrypt: (params) => decrypt(client, params),
    requestRecords: (params) => requestRecords(client, params),
    transactionStatus: (params) => transactionStatus(client, params),
    switchChain: (params) => switchChain(client, params),
    switchNetwork: (params) => switchChain(client, params),
    requestTransactionHistory: (params) => requestTransactionHistory(client, params),
    getChainId: () => getChainId(client),
    getNetwork: () => getChainId(client),
  }
}
