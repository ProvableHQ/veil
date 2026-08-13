import type { Address, Hash, Hex } from 'viem'
import type { BridgeTransferPlan, BridgeTransferReceipt } from './protocol.js'
import type { AleoBridgeExecutor } from './aleo.js'

/**
 * Sends JSON-RPC requests through an injected or application-provided EVM wallet.
 *
 * The shape is compatible with EIP-1193 providers exposed by wallets such as
 * MetaMask and Phantom. The bridge package never reads a runtime global.
 *
 * @property request Executes one EIP-1193 request, which may prompt the wallet for transaction approval.
 * @property account Optional connected account. When omitted, the executor resolves the first `eth_accounts` entry.
 */
export type EvmBridgeExecutor = {
  request: (args: {
    method: string
    params?: readonly unknown[] | Record<string, unknown> | undefined
  }) => Promise<unknown>
  account?: Address | undefined
}

/**
 * Groups optional chain executors supplied to a bridge client.
 *
 * @property evm EIP-1193 executor used by Ethereum bridge actions when present.
 * @property aleo Wallet client used only for user-authorized Aleo transactions such as private USDCx minting.
 */
export type BridgeExecutors = {
  evm?: EvmBridgeExecutor | undefined
  aleo?: AleoBridgeExecutor | undefined
}

/** Identifies the Ethereum Hyperlane router's collateral model. */
export type EvmHyperlaneRouterType = 'native' | 'collateral'

/**
 * Captures the reviewed metadata required to dispatch an Ethereum Warp Route transfer.
 *
 * @property routerAddress Contract receiving `transferRemote`.
 * @property sourceChainId EIP-155 chain id expected from the connected wallet.
 * @property destinationDomain Hyperlane domain passed to `transferRemote` as a uint32.
 * @property routerType Whether the router locks native ETH or ERC-20 collateral.
 * @property tokenAddress ERC-20 collateral contract. Required for collateral routers.
 * @property destinationRouter Protocol-native identifier of the enrolled Aleo router.
 * @property mailboxAddress Ethereum Hyperlane Mailbox used by the reviewed deployment.
 * @property interchainGasPaymaster Ethereum gas-paymaster identifier used by the reviewed deployment.
 * @property interchainSecurityModule Route-specific ISM, or the zero address when the Mailbox default applies.
 * @property registryCommit Hyperlane Registry commit containing the deployment snapshot.
 * @property requiresApprovalReset Whether a non-zero ERC-20 allowance must be reset before changing it.
 */
export type EvmHyperlaneRouteMetadata = {
  routerAddress: Address
  sourceChainId: number
  destinationDomain: number
  routerType: EvmHyperlaneRouterType
  tokenAddress?: Address | undefined
  destinationRouter: string
  mailboxAddress: Address
  interchainGasPaymaster: Address
  interchainSecurityModule: Address
  registryCommit: string
  requiresApprovalReset?: boolean | undefined
}

/**
 * Selects a prepared Ethereum Hyperlane transfer for live fee quoting.
 *
 * @property plan Pure transfer plan returned by `prepareTransfer`.
 * @property recipientBytes32 Aleo recipient in the exact 32-byte encoding expected by the enrolled Warp Route.
 */
export type QuoteEvmHyperlaneTransferParameters = {
  plan: BridgeTransferPlan
  recipientBytes32: Hex
}

/**
 * Captures the atomic values required by an Ethereum Warp Route transaction.
 *
 * @property routeId Route whose deployment and amount were quoted.
 * @property routerAddress Contract that supplied the quote.
 * @property sourceChainId EIP-155 chain id on which submission must occur.
 * @property destinationDomain Hyperlane destination domain supplied to the router.
 * @property recipientBytes32 Wire-format destination recipient.
 * @property amountAtomic Asset amount passed to `transferRemote`.
 * @property nativeValueAtomic Total `msg.value` required by the router.
 * @property nativeFeeAtomic Native fee above the bridged amount for native routes, or the full native fee for collateral routes.
 * @property tokenAmountAtomic ERC-20 amount requiring allowance for collateral routes.
 * @property tokenAddress ERC-20 collateral contract for collateral routes.
 */
export type EvmHyperlaneTransferQuote = {
  routeId: string
  routerAddress: Address
  sourceChainId: number
  destinationDomain: number
  recipientBytes32: Hex
  amountAtomic: bigint
  nativeValueAtomic: bigint
  nativeFeeAtomic: bigint
  tokenAmountAtomic?: bigint | undefined
  tokenAddress?: Address | undefined
}

/**
 * Configures an Ethereum Hyperlane submission.
 *
 * The action requotes immediately before submission. ERC-20 allowance is
 * checked first and only insufficient allowances generate approval calls.
 *
 * @property plan Pure transfer plan returned by `prepareTransfer`.
 * @property recipientBytes32 Aleo recipient in the exact 32-byte encoding expected by the enrolled Warp Route.
 * @property pollingIntervalMs Delay between transaction-receipt checks. Defaults to 1,000 milliseconds.
 * @property confirmationTimeoutMs Maximum time to wait for each approval or dispatch receipt. Defaults to 120,000 milliseconds; a timeout returns resumable pending state.
 */
export type ExecuteEvmHyperlaneTransferParameters = {
  plan: BridgeTransferPlan
  recipientBytes32: Hex
  pollingIntervalMs?: number | undefined
  confirmationTimeoutMs?: number | undefined
}

/**
 * Captures wallet transactions and resumable Hyperlane progress after execution.
 *
 * @property receipt Protocol-neutral transfer state, including the source transaction and message id when confirmed.
 * @property approvalTxIds ERC-20 approval transactions submitted before dispatch.
 */
export type EvmHyperlaneTransferExecution = {
  receipt: BridgeTransferReceipt
  approvalTxIds: Hash[]
}
