import { getBlockNumber, type GetBlockNumberReturnType } from '../../actions/public/getBlockNumber.js'
import { getBlock, type GetBlockParameters, type GetBlockReturnType } from '../../actions/public/getBlock.js'
import { getTransaction, type GetTransactionParameters, type GetTransactionReturnType } from '../../actions/public/getTransaction.js'
import { getBalance, type GetBalanceParameters, type GetBalanceReturnType } from '../../actions/public/getBalance.js'
import { readContract, type ReadContractParameters, type ReadContractReturnType } from '../../actions/public/readContract.js'
import { getCode, type GetCodeParameters, type GetCodeReturnType } from '../../actions/public/getCode.js'
import { estimateGas, type EstimateGasParameters, type EstimateGasReturnType } from '../../actions/public/estimateGas.js'
import { getRecords, type GetRecordsParameters, type GetRecordsReturnType } from '../../actions/public/getRecords.js'
import { getTransitionViewKeys, type GetTransitionViewKeysParameters, type GetTransitionViewKeysReturnType } from '../../actions/public/getTransitionViewKeys.js'
import type { Client } from '../createClient.js'

export type PublicActions = {
  getBlockNumber: () => Promise<GetBlockNumberReturnType>
  getBlock: (params: GetBlockParameters) => Promise<GetBlockReturnType>
  getTransaction: (params: GetTransactionParameters) => Promise<GetTransactionReturnType>
  getBalance: (params: GetBalanceParameters) => Promise<GetBalanceReturnType>
  readContract: (params: ReadContractParameters) => Promise<ReadContractReturnType>
  getCode: (params: GetCodeParameters) => Promise<GetCodeReturnType>
  estimateGas: (params: EstimateGasParameters) => Promise<EstimateGasReturnType>
  getRecords: (params: GetRecordsParameters) => Promise<GetRecordsReturnType>
  getTransitionViewKeys: (params: GetTransitionViewKeysParameters) => Promise<GetTransitionViewKeysReturnType>
}

export function publicActions(client: Client): PublicActions {
  return {
    getBlockNumber: () => getBlockNumber(client),
    getBlock: (params) => getBlock(client, params),
    getTransaction: (params) => getTransaction(client, params),
    getBalance: (params) => getBalance(client, params),
    readContract: (params) => readContract(client, params),
    getCode: (params) => getCode(client, params),
    estimateGas: (params) => estimateGas(client, params),
    getRecords: (params) => getRecords(client, params),
    getTransitionViewKeys: (params) => getTransitionViewKeys(client, params),
  }
}
