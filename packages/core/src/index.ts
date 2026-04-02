// Types
export type {
  Account,
  SignerAccount,
  LocalAccount,
  RpcAccount,
  ViewOnlyAccount,
  AnyAccount,
} from './types/account.js'

export type {
  RequestFn,
  TransportConfig,
  Transport,
} from './types/transport.js'

export type {
  ProvingConfig,
  BuildTransactionOptions,
} from './types/proving.js'

export type {
  RecordsConfig,
  RecordSearchParams,
  AleoRecord,
} from './types/records.js'

export type { Block, ConfirmedTransaction } from './types/block.js'
export type { Transaction, Transition } from './types/transaction.js'
export type { Program, ProgramFunction, ProgramMapping, MappingValue } from './types/program.js'

// Errors
export {
  BaseError,
  TransportError,
  AccountNotFoundError,
  ProvingNotConfiguredError,
  InvalidAddressError,
  ProgramNotFoundError,
  InvalidInputError,
} from './errors/errors.js'

// Utils
export { isAddress, assertAddress } from './utils/address.js'
export { creditsToMicrocredits, microcreditsToCredits } from './utils/credits.js'
export { parseValue, encodeValue, type ParsedValue } from './utils/values.js'

// Transports
export { createTransport } from './transports/createTransport.js'
export { http } from './transports/http.js'
export { custom } from './transports/custom.js'
export { fallback } from './transports/fallback.js'

// Clients
export { createClient, type Client, type ClientConfig } from './clients/createClient.js'
export { createPublicClient, type PublicClient, type PublicClientConfig } from './clients/createPublicClient.js'
export {
  createWalletClient,
  type WalletClient,
  type WalletClientConfig,
  type RpcWalletClientConfig,
  type LocalWalletClientConfig,
} from './clients/createWalletClient.js'
export type { PublicActions } from './clients/decorators/public.js'
export type { WalletActions } from './clients/decorators/wallet.js'

// Accounts
export { rpcAccount } from './accounts/rpcAccount.js'
export { privateKeyToAccount } from './accounts/privateKeyToAccount.js'
export { mnemonicToAccount } from './accounts/mnemonicToAccount.js'
export { viewOnlyAccount } from './accounts/viewOnlyAccount.js'
export { toAccount } from './accounts/toAccount.js'

// Public Actions (standalone)
export { getBlockNumber } from './actions/public/getBlockNumber.js'
export { getBlock } from './actions/public/getBlock.js'
export { getTransaction } from './actions/public/getTransaction.js'
export { getBalance } from './actions/public/getBalance.js'
export { readContract } from './actions/public/readContract.js'
export { getCode } from './actions/public/getCode.js'
export { estimateGas } from './actions/public/estimateGas.js'
export { getRecords } from './actions/public/getRecords.js'
export { getTransitionViewKeys } from './actions/public/getTransitionViewKeys.js'

// Wallet Actions (standalone)
export { writeContract, executeTransaction } from './actions/wallet/writeContract.js'
export { deployContract } from './actions/wallet/deployContract.js'
export { sendTransaction } from './actions/wallet/sendTransaction.js'
export { signMessage } from './actions/wallet/signMessage.js'
export { transfer } from './actions/wallet/transfer.js'
export { decrypt } from './actions/wallet/decrypt.js'
export { requestRecords } from './actions/wallet/requestRecords.js'

// Contract
export { getContract, type ContractInstance } from './contract/getContract.js'
export { parseProgram } from './contract/parseProgram.js'
