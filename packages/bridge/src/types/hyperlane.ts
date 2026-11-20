/**
 * Carries public address commitment bytes compatible with `requestAddressEncoding`.
 * The issuing wallet or local account retains the counter and secret needed to claim funds.
 * @property commitmentHex Canonical 32-byte little-endian BHP256 commitment, lowercase hex without `0x`.
 * @example const encoding: HyperlaneAddressEncoding = { commitmentHex: '11'.repeat(32) }
 */
export type HyperlaneAddressEncoding = { commitmentHex: string }

/**
 * Selects private Hyperlane delivery using an existing address commitment.
 * @property addressEncoding Commitment derived for the plan's recipient and route network. Reuse it through execution and recovery.
 * @example const options: HyperlaneOptions = { addressEncoding: { commitmentHex: '11'.repeat(32) } }
 */
export type HyperlaneOptions = { addressEncoding: HyperlaneAddressEncoding }

/**
 * Supplies private inputs for a Hyperlane destination claim.
 * @property secretNonce Optional caller-managed scalar. Omission requests `hyperlane-claim-secret` from the issuing wallet; local accounts must supply it.
 * @property merkleProof Optional recipient exclusion proof literal. Omission requests wallet derivation at input four; local accounts must supply a literal.
 * @example const options: HyperlaneClaimOptions = { secretNonce: '123scalar', merkleProof: '[...]' }
 */
export type HyperlaneClaimOptions = {
  secretNonce?: string | undefined
  merkleProof?: string | undefined
}

/**
 * Selects an encoding to look up on a reviewed Aleo warp route.
 * @property routeId Identifies an active inbound Hyperlane route with reviewed private claim metadata.
 * @property addressEncoding Supplies canonical commitment bytes; no secret or counter crosses this boundary.
 * @example const params: ReadHyperlaneClaimableAmountParameters = { routeId, addressEncoding }
 */
export type ReadHyperlaneClaimableAmountParameters = {
  routeId: string
  addressEncoding: HyperlaneAddressEncoding
}

/**
 * Records a derived encoding found in the warp route's claimable mapping.
 * @property counter Identifies the existing wallet derivation counter, an unsigned u32.
 * @property addressEncoding Contains only the public commitment bytes.
 * @property claimableAmount Reports the current balance in destination base units, an unsigned u128. Zero proves mapping presence, not spendable funds or completed delivery.
 * @example const entry: HyperlaneAddressEncodingEntry = { counter: 7, addressEncoding, claimableAmount: 100n }
 */
export type HyperlaneAddressEncodingEntry = {
  counter: number
  addressEncoding: HyperlaneAddressEncoding
  claimableAmount: bigint
}

/**
 * Configures bounded discovery of existing address encodings through Aleo state.
 * @property routeId Selects the reviewed destination program and claimable mapping.
 * @property deriveAddressEncoding Re-derives an existing public encoding for a u32 counter using the original recipient, network, and generic `address_commitment_v1` scheme. MUST NOT issue fresh identities or use the legacy xReserve derivation.
 * @property startCounter Starts at this inclusive u32 counter. Defaults to zero; pass a prior result's nextCounter to continue.
 * @property maxCounters Limits this call to 1..100,000 sequential derivations and mapping reads. Defaults to 100.
 * @property signal Cancels discovery between derivations and reads. Defaults to no cancellation; an in-flight read may finish before cancellation is observed.
 * @example const params: ScanHyperlaneAddressEncodingsParameters = { routeId, deriveAddressEncoding, maxCounters: 20 }
 */
export type ScanHyperlaneAddressEncodingsParameters = {
  routeId: string
  deriveAddressEncoding: (counter: number) => HyperlaneAddressEncoding | Promise<HyperlaneAddressEncoding>
  startCounter?: number | undefined
  maxCounters?: number | undefined
  signal?: AbortSignal | undefined
}

/**
 * Returns public encodings found during one bounded counter scan.
 * @property entries Contains every present mapping entry, including zero balances, in counter order. Balances are snapshots and MUST be reread before claiming.
 * @property nextCounter Identifies the first unchecked u32 counter. Undefined means the u32 counter space is exhausted, not that every deposit has been claimed.
 * @example const result: HyperlaneAddressEncodingScanResult = { entries: [], nextCounter: 100 }
 */
export type HyperlaneAddressEncodingScanResult = {
  entries: HyperlaneAddressEncodingEntry[]
  nextCounter: number | undefined
}
