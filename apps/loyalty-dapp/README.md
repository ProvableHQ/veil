# Loyalty dApp

The reference app uses the clients in `src/lib/aleo.ts` for the loyalty program.
The loyalty program has no freezelist proof input, so its calls require no
freezelist algorithm grants.

For an ARC-22 payment flow added to this app, import `freezelistProofRequest`,
`freezelistProofGrant`, and `FREEZELIST_PROOF_ALGORITHM` from
`@provablehq/veil-core`. Check the connected wallet's `algorithmsSupported()` and
include a grant for each executed proof slot in the wallet connection options.
For an explicit ARC-22 private token transfer, the inputs are recipient,
amount, record, and proof; the proof grant uses zero-based position 3.

Pass the selected record to `walletClient.transfer({ record, ... })` and the
request to `merkleProof`. The request's `freezelistProgram` must name the
program owning the root checked by the deployed token. Omit `address` for a
signer proof; provide the actual subject for recipient or withdrawal proofs.
The wallet resolves these inputs during execution, and failures should remain
visible to the caller. See the [core example](../../packages/core/README.md#wallet-generated-freezelist-proofs)
for the complete input and grant shape.

Shield Swap integrations use automatic proof resolution and include freezelist
grants in `shieldSwapAlgorithmGrants()` by default. Custom wrapper deployments
must pass matching `freezelists` configuration to the grant helper and
`shieldSwapActions`. See [Shield Swap proofs](../../packages/shield-swap/README.md#freezelist-proofs).

Bridge ARC-22 unshielding and private xReserve burns also resolve compliance
proofs automatically. Omit `merkleProof` and supply the matching
`unshieldFreezelistProofGrant` or `xReserveBurnFreezelistProofGrant` when connecting
the wallet. Local SDK clients generate and cache the witness instead. See
[Bridge compliance proofs](../../packages/bridge/README.md#automatic-compliance-proofs).
