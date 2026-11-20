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

Fee-tier discovery through `client.api.getFeeTiers()` is public and requires no
wallet authentication or API token.

Bridge ARC-22 unshielding and private xReserve burns also resolve compliance
proofs automatically. Omit `merkleProof` and supply the matching
`unshieldFreezelistProofGrant` or `xReserveBurnFreezelistProofGrant` when connecting
the wallet. Local SDK clients generate and cache the witness instead. See
[Bridge compliance proofs](../../packages/bridge/README.md#automatic-compliance-proofs).

Private Hyperlane bridge integrations use a wallet-issued address encoding and
separate recipient claim grants from `hyperlanePrivateClaimGrants`. A message
delivery still requires the recipient claim before funds are spendable. The
loyalty app has no bridge routes configured; add a reviewed private destination
registry before offering this flow. See [private Hyperlane delivery](../../packages/bridge/docs/hyperlane-private-mint.md)
and the [example](../../packages/bridge/examples/private-hyperlane.ts).

Private Hyperlane recovery checks the destination warp route's `claimable` mapping.
A funded encoding can be recovered without source transaction or message ids;
bounded counter scans re-derive existing encodings in the wallet host or local
account and query Aleo directly. Zero balance is distinct from an absent entry
and does not prove completion. See the bridge guide above for discovery and retry.

Private outbound Hyperlane fee inspection uses
`hyperlane.aleo.quotePrivateTransfer` with reviewed private ABI and fee-mapping
metadata. The token protocol fee is included in the gross record spend and
reduces destination tokens; dispatch credits and Aleo execution fees are
separate. The current SDK outbound execution helpers remain public-only.
