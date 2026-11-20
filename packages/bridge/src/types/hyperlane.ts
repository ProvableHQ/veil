/**
 * Carries the public response from a wallet's `requestAddressEncoding` method.
 * The issuing wallet retains the counter and secret needed to claim funds.
 * @property commitmentHex Canonical 32-byte little-endian BHP256 commitment, lowercase hex without `0x`.
 * @example const encoding: HyperlaneAddressEncoding = { commitmentHex: '11'.repeat(32) }
 */
export type HyperlaneAddressEncoding = { commitmentHex: string }

/**
 * Selects private Hyperlane delivery using an existing wallet-issued identity.
 * @property addressEncoding Commitment issued for the plan's recipient and route network. Reuse it through execution and recovery.
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
