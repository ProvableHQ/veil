import { getBlockNumber, type GetBlockNumberReturnType } from '../../actions/public/getBlockNumber.js'
import { getBlock, type GetBlockParameters, type GetBlockReturnType } from '../../actions/public/getBlock.js'
import { getTransaction, type GetTransactionParameters, type GetTransactionReturnType } from '../../actions/public/getTransaction.js'
import { getBalance, type GetBalanceParameters, type GetBalanceReturnType } from '../../actions/public/getBalance.js'
import { readContract, type ReadContractParameters, type ReadContractReturnType } from '../../actions/public/readContract.js'
import {
  getCode,
  type GetCodeParameters,
  type GetCodeReturnType,
  getProgram,
  type GetProgramParameters,
  type GetProgramReturnType,
} from '../../actions/public/getCode.js'
import { getRecords, type GetRecordsParameters, type GetRecordsReturnType } from '../../actions/public/getRecords.js'
import { getTransitionViewKeys, type GetTransitionViewKeysParameters, type GetTransitionViewKeysReturnType } from '../../actions/public/getTransitionViewKeys.js'
import { getBlockHash, type GetBlockHashReturnType } from '../../actions/public/getBlockHash.js'
import { getBlockTransactions, type GetBlockTransactionsParameters, type GetBlockTransactionsReturnType } from '../../actions/public/getBlockTransactions.js'
import { getBlocks, type GetBlocksParameters, type GetBlocksReturnType } from '../../actions/public/getBlocks.js'
import { getBlockSummary, type GetBlockSummaryReturnType } from '../../actions/public/getBlockSummary.js'
import { getStateRoot, type GetStateRootParameters, type GetStateRootReturnType } from '../../actions/public/getStateRoot.js'
import { getStatePath, type GetStatePathParameters, type GetStatePathReturnType } from '../../actions/public/getStatePath.js'
import { getConfirmedTransaction, type GetConfirmedTransactionParameters, type GetConfirmedTransactionReturnType } from '../../actions/public/getConfirmedTransaction.js'
import { getUnconfirmedTransaction, type GetUnconfirmedTransactionParameters, type GetUnconfirmedTransactionReturnType } from '../../actions/public/getUnconfirmedTransaction.js'
import { getTransactionsByAddress, type GetTransactionsByAddressParameters, type GetTransactionsByAddressReturnType } from '../../actions/public/getTransactionsByAddress.js'
import { getTransactionSummary, type GetTransactionSummaryReturnType } from '../../actions/public/getTransactionSummary.js'
import { findBlockHash, type FindBlockHashParameters, type FindBlockHashReturnType } from '../../actions/public/findBlockHash.js'
import { findTransactionId, type FindTransactionIdParameters, type FindTransactionIdReturnType } from '../../actions/public/findTransactionId.js'
import { getTransitions, type GetTransitionsParameters, type GetTransitionsReturnType } from '../../actions/public/getTransitions.js'
import { findTransitionId, type FindTransitionIdParameters, type FindTransitionIdReturnType } from '../../actions/public/findTransitionId.js'
import { getMappingNames, type GetMappingNamesParameters, type GetMappingNamesReturnType } from '../../actions/public/getMappingNames.js'
import { getDeploymentTransaction, type GetDeploymentTransactionParameters, type GetDeploymentTransactionReturnType } from '../../actions/public/getDeploymentTransaction.js'
import { getProgramCalls, type GetProgramCallsParameters, type GetProgramCallsReturnType } from '../../actions/public/getProgramCalls.js'
import { getCommittee, type GetCommitteeParameters, type GetCommitteeReturnType } from '../../actions/public/getCommittee.js'
import { getDelegators, type GetDelegatorsParameters, type GetDelegatorsReturnType } from '../../actions/public/getDelegators.js'
import { getStakingEarnings, type GetStakingEarningsParameters, type GetStakingEarningsReturnType } from '../../actions/public/getStakingEarnings.js'
import { getTransactionMetrics, type GetTransactionMetricsReturnType } from '../../actions/public/getTransactionMetrics.js'
import { getProgramMetrics, type GetProgramMetricsReturnType } from '../../actions/public/getProgramMetrics.js'
import { getApy, type GetApyReturnType } from '../../actions/public/getApy.js'
import { getValidatorApy, type GetValidatorApyReturnType } from '../../actions/public/getValidatorApy.js'
import { getTotalSupply, type GetTotalSupplyReturnType } from '../../actions/public/getTotalSupply.js'
import { getCirculatingSupply, type GetCirculatingSupplyReturnType } from '../../actions/public/getCirculatingSupply.js'
import { getTvl, type GetTvlReturnType } from '../../actions/public/getTvl.js'
import { getTokens, type GetTokensReturnType } from '../../actions/public/getTokens.js'
import { readMapping, type ReadMappingParameters, type ReadMappingReturnType } from '../../actions/public/readMapping.js'
import type { Client } from '../createClient.js'

export type PublicActions = {
  getBlockNumber: () => Promise<GetBlockNumberReturnType>
  getBlock: (params: GetBlockParameters) => Promise<GetBlockReturnType>
  getTransaction: (params: GetTransactionParameters) => Promise<GetTransactionReturnType>
  getBalance: (params: GetBalanceParameters) => Promise<GetBalanceReturnType>
  readContract: (params: ReadContractParameters) => Promise<ReadContractReturnType>
  getCode: (params: GetCodeParameters) => Promise<GetCodeReturnType>
  getProgram: (params: GetProgramParameters) => Promise<GetProgramReturnType>
  getRecords: (params: GetRecordsParameters) => Promise<GetRecordsReturnType>
  getTransitionViewKeys: (params: GetTransitionViewKeysParameters) => Promise<GetTransitionViewKeysReturnType>
  getBlockHash: () => Promise<GetBlockHashReturnType>
  getBlockTransactions: (params: GetBlockTransactionsParameters) => Promise<GetBlockTransactionsReturnType>
  getBlocks: (params: GetBlocksParameters) => Promise<GetBlocksReturnType>
  getBlockSummary: () => Promise<GetBlockSummaryReturnType>
  getStateRoot: (params?: GetStateRootParameters) => Promise<GetStateRootReturnType>
  getStatePath: (params: GetStatePathParameters) => Promise<GetStatePathReturnType>
  getConfirmedTransaction: (params: GetConfirmedTransactionParameters) => Promise<GetConfirmedTransactionReturnType>
  getUnconfirmedTransaction: (params: GetUnconfirmedTransactionParameters) => Promise<GetUnconfirmedTransactionReturnType>
  getTransactionsByAddress: (params: GetTransactionsByAddressParameters) => Promise<GetTransactionsByAddressReturnType>
  getTransactionSummary: () => Promise<GetTransactionSummaryReturnType>
  findBlockHash: (params: FindBlockHashParameters) => Promise<FindBlockHashReturnType>
  findTransactionId: (params: FindTransactionIdParameters) => Promise<FindTransactionIdReturnType>
  getTransitions: (params: GetTransitionsParameters) => Promise<GetTransitionsReturnType>
  findTransitionId: (params: FindTransitionIdParameters) => Promise<FindTransitionIdReturnType>
  getMappingNames: (params: GetMappingNamesParameters) => Promise<GetMappingNamesReturnType>
  getDeploymentTransaction: (params: GetDeploymentTransactionParameters) => Promise<GetDeploymentTransactionReturnType>
  getProgramCalls: (params: GetProgramCallsParameters) => Promise<GetProgramCallsReturnType>
  getCommittee: (params?: GetCommitteeParameters) => Promise<GetCommitteeReturnType>
  getDelegators: (params: GetDelegatorsParameters) => Promise<GetDelegatorsReturnType>
  getStakingEarnings: (params: GetStakingEarningsParameters) => Promise<GetStakingEarningsReturnType>
  getTransactionMetrics: () => Promise<GetTransactionMetricsReturnType>
  getProgramMetrics: () => Promise<GetProgramMetricsReturnType>
  getApy: () => Promise<GetApyReturnType>
  getValidatorApy: () => Promise<GetValidatorApyReturnType>
  getTotalSupply: () => Promise<GetTotalSupplyReturnType>
  getCirculatingSupply: () => Promise<GetCirculatingSupplyReturnType>
  getTvl: () => Promise<GetTvlReturnType>
  getTokens: () => Promise<GetTokensReturnType>
  readMapping: (params: ReadMappingParameters) => Promise<ReadMappingReturnType>
}

export function publicActions(client: Client): PublicActions {
  return {
    getBlockNumber: () => getBlockNumber(client),
    getBlock: (params) => getBlock(client, params),
    getTransaction: (params) => getTransaction(client, params),
    getBalance: (params) => getBalance(client, params),
    readContract: (params) => readContract(client, params),
    getCode: (params) => getCode(client, params),
    getProgram: (params) => getProgram(client, params),
    getRecords: (params) => getRecords(client, params),
    getTransitionViewKeys: (params) => getTransitionViewKeys(client, params),
    getBlockHash: () => getBlockHash(client),
    getBlockTransactions: (params) => getBlockTransactions(client, params),
    getBlocks: (params) => getBlocks(client, params),
    getBlockSummary: () => getBlockSummary(client),
    getStateRoot: (params) => getStateRoot(client, params),
    getStatePath: (params) => getStatePath(client, params),
    getConfirmedTransaction: (params) => getConfirmedTransaction(client, params),
    getUnconfirmedTransaction: (params) => getUnconfirmedTransaction(client, params),
    getTransactionsByAddress: (params) => getTransactionsByAddress(client, params),
    getTransactionSummary: () => getTransactionSummary(client),
    findBlockHash: (params) => findBlockHash(client, params),
    findTransactionId: (params) => findTransactionId(client, params),
    getTransitions: (params) => getTransitions(client, params),
    findTransitionId: (params) => findTransitionId(client, params),
    getMappingNames: (params) => getMappingNames(client, params),
    getDeploymentTransaction: (params) => getDeploymentTransaction(client, params),
    getProgramCalls: (params) => getProgramCalls(client, params),
    getCommittee: (params) => getCommittee(client, params),
    getDelegators: (params) => getDelegators(client, params),
    getStakingEarnings: (params) => getStakingEarnings(client, params),
    getTransactionMetrics: () => getTransactionMetrics(client),
    getProgramMetrics: () => getProgramMetrics(client),
    getApy: () => getApy(client),
    getValidatorApy: () => getValidatorApy(client),
    getTotalSupply: () => getTotalSupply(client),
    getCirculatingSupply: () => getCirculatingSupply(client),
    getTvl: () => getTvl(client),
    getTokens: () => getTokens(client),
    readMapping: (params) => readMapping(client, params),
  }
}
