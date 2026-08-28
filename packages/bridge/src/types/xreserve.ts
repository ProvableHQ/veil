import type { Address, Hash, Hex } from 'viem'
import type { BridgeTransferPlan, BridgeTransferReceipt } from './protocol.js'

/**
 * Supplies a fetch-compatible HTTP response for Circle attestation requests.
 *
 * @property ok Whether the response status is successful.
 * @property status Numeric HTTP status used to distinguish pending attestations.
 * @property json Parses the response body as JSON.
 */
export type XReserveHttpResponse = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

/** Sends an HTTP request without coupling the bridge client to a runtime global. */
export type XReserveHttpTransport = (url: string, init?: { signal?: AbortSignal }) => Promise<XReserveHttpResponse>

/**
 * Captures reviewed EVM-to-Aleo xReserve deployment values.
 *
 * @property xReserveContract EVM contract receiving deposits.
 * @property sourceChainId Expected EIP-155 wallet chain id.
 * @property sourceDomain Circle domain included in the deposit nonce.
 * @property remoteDomain Aleo Circle domain passed to `depositToRemote`.
 * @property remoteTokenBytes32 Aleo USDCx token identifier in Circle wire form.
 * @property minimumAmountAtomic Smallest supported deposit in USDC base units.
 * @property maxFeeAtomic Maximum Circle fee in USDC base units.
 * @property bridgeProgram Aleo program handling public and record mints.
 * @property wrapperProgram Aleo program handling private wrapper mints.
 * @property attestationBaseUrl Circle endpoint prefix for individual message hashes.
 */
export type EvmXReserveRouteMetadata = {
  xReserveContract: Address
  sourceChainId: number
  sourceDomain: number
  remoteDomain: number
  remoteTokenBytes32: Hex
  minimumAmountAtomic: bigint
  maxFeeAtomic: bigint
  bridgeProgram: string
  wrapperProgram: string
  attestationBaseUrl: string
}

/**
 * Selects a prepared xReserve transfer for live balance and allowance checks.
 *
 * @property plan Pure plan returned by `prepareTransfer`.
 */
export type QuoteEvmXReserveTransferParameters = {
  plan: BridgeTransferPlan
}

/**
 * Captures atomic values and allowance state required by an xReserve deposit.
 *
 * @property routeId Reviewed route used for the quote.
 * @property xReserveContract Contract receiving the deposit.
 * @property tokenAddress USDC contract approved and deposited.
 * @property sourceChainId Expected EIP-155 wallet chain id.
 * @property remoteDomain Aleo Circle domain supplied to the contract.
 * @property remoteRecipientBytes32 User or wrapper address in wire form.
 * @property amountAtomic Deposit amount in USDC base units.
 * @property maxFeeAtomic Maximum Circle fee in USDC base units.
 * @property hookData Fixed 65-byte Aleo mint instruction.
 * @property balanceAtomic Connected account balance in USDC base units.
 * @property allowanceAtomic Current xReserve allowance in USDC base units.
 * @property approvalRequired Whether execution must submit an approval first.
 */
export type EvmXReserveTransferQuote = {
  routeId: string
  xReserveContract: Address
  tokenAddress: Address
  sourceChainId: number
  remoteDomain: number
  remoteRecipientBytes32: Hex
  amountAtomic: bigint
  maxFeeAtomic: bigint
  hookData: Hex
  balanceAtomic: bigint
  allowanceAtomic: bigint
  approvalRequired: boolean
}

/**
 * Configures an EVM-to-Aleo xReserve deposit submission.
 *
 * @property plan Pure plan returned by `prepareTransfer`.
 * @property pollingIntervalMs Delay between receipt checks. Defaults to 1,000 milliseconds.
 * @property confirmationTimeoutMs Maximum receipt wait per transaction. Defaults to 120,000 milliseconds.
 */
export type ExecuteEvmXReserveTransferParameters = {
  plan: BridgeTransferPlan
  pollingIntervalMs?: number | undefined
  confirmationTimeoutMs?: number | undefined
}

/**
 * Captures wallet transactions and resumable xReserve progress after execution.
 *
 * @property receipt Protocol-neutral status plus Circle payload identifiers.
 * @property approvalTxIds ERC-20 approvals submitted before the deposit.
 */
export type EvmXReserveTransferExecution = {
  receipt: BridgeTransferReceipt
  approvalTxIds: Hash[]
}

/**
 * Selects a Circle attestation by its 32-byte message hash.
 *
 * @property routeId Route supplying the environment-specific Circle endpoint.
 * @property messageHash Keccak-256 hash returned by deposit execution.
 * @property signal Optional cancellation signal. Defaults to no cancellation.
 */
export type GetXReserveAttestationParameters = {
  routeId: string
  messageHash: Hash
  signal?: AbortSignal | undefined
}

/** Reports whether Circle has produced the signature for an xReserve message. */
export type XReserveAttestationResult =
  | { status: 'pending', messageHash: Hash }
  | { status: 'complete', messageHash: Hash, payload: Hex, attestation: Hex }
