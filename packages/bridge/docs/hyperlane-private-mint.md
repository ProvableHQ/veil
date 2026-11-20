# Receive Hyperlane funds privately on Aleo

Private inbound Hyperlane transfers place a wallet-issued BHP256 address
commitment in the source router's existing recipient slot. After message
delivery, the recipient authorizes `claim_private` to receive a private token
record. The source `transferRemote(destination, recipient, amount)` ABI stays
unchanged for both EVM and Solana routes.

Public delivery remains the default. The bundled production registry remains
public-only: a private destination MUST be verified and explicitly enabled in
an injected `BridgeRegistry`. An address encoding alone does not establish that
a destination supports claims. Aleo-origin withdrawals use their existing APIs.

## Register a reviewed private destination

The canonical ABI reference is [shield-core PR #604](https://github.com/ProvableHQ/shield-core/pull/604),
branch `feat/address-encoding-hyperlane`, inspected at commit
`ba0ae75fea7a39b1cbde04736d51a43dc8a1ae44`. Its
[claim specification](https://github.com/ProvableHQ/shield-core/blob/ba0ae75fea7a39b1cbde04736d51a43dc8a1ae44/docs/hyperlane-private-mint.md)
distinguishes protocol support from verified deployment support. At that commit,
the wallet's dapp claim fulfillment is registered for testnet
`test_hyp_warp_token_eth_v2.aleo`; managed production routes remain public-only.

Verify the deployed source router, enrolled destination router, network/domain,
claim ABI, recipient freezelist, claimable mapping, mailbox, and pause flags.
Retain the existing route metadata and set these additional metadata fields on
the active inbound route:

| Field | Required value |
| --- | --- |
| `privateMintEncoding` | `address_commitment_v1` |
| `privateMintAbi` | `claim_private_v1` for the five-input ABI below |
| `privateMintProgram` | Verified destination warp program id |
| `privateMintMapping` | `claimable` on the verified warp route (`[u128; 2] -> u128`), or an explicitly reviewed custom mapping name |
| `privateMintFreezelistProgram` | Program whose exclusion proofs the claim checks |
| `privateMintCommit` | Lowercase 40-character upstream commit pinning the deployment evidence |
| `destinationRouter` | The same program, optionally followed by `/aleo1…` |
| `aleoMailboxProgram` | Verified destination mailbox program |

Include the destination claim pause flags in the route's `pauseSources`.
Do not mark an incomplete deployment active. Do not enable production routes
based solely on the presence of `claim_private` in a program.

## Obtain and retain the wallet encoding

Call the connected wallet provider's `requestAddressEncoding` with the route's
`network` (`mainnet` or `testnet`) and optional Aleo `recipient`. The public
response is `{ commitmentHex }`, exactly 64 lowercase hex characters without
`0x`. The encoding must belong to the transfer recipient on that network.
Each issuance reserves a fresh identity; keep the original encoding for retries.
The issuing wallet must retain or restore its counter association.

Pass the response to `bridge.quote`:

```ts
const quote = await bridge.quote({
  source: { chain: 'sepolia', asset: 'eth' },
  destination: { chain: 'aleo-testnet', asset: 'eth' },
  amount: '0.001',
  recipient,
  mintMode: 'private',
  hyperlane: { addressEncoding },
})
```

The example endpoints require an injected reviewed route. Supplying
`hyperlane.addressEncoding` selects private mode when `mintMode` is omitted.
An explicit public or record mode conflicts with the encoding. Private mode
without an encoding is rejected before quoting reads a chain.

`hyperlanePrivateClaimGrants({ registry, plan: quote.plan })` returns the exact
secret and proof grants to include when connecting the issuing Aleo wallet.
Existing USDCx grants do not authorize these claim inputs. Grants authorize
`hyperlane-claim-secret` at input 3 and `program-freezelist-exclusion-proof` at
input 4 of the reviewed program's `claim_private` function.

## Execute, claim, and recover

Submit `bridge.execute({ plan: quote.plan, onCheckpoint: save })` and follow its
receipt with `bridge.getStatus` or `bridge.wait`. EVM uses `0x` followed by the
commitment bytes; Solana copies the same bytes into its recipient slot. Neither
path reverses the bytes or changes the source call's argument layout.

The warp route's `claimable` mapping is authoritative for private claim readiness.
The SDK reads the current balance and returns `DESTINATION_ACTION_REQUIRED` (progress
`next: 'complete'`) when enough funds are available. Call `bridge.complete`
with that progress and the issuing Aleo wallet. The claim uses:

| Input | Value |
| --- | --- |
| 0 | Commitment as `[low_u128, high_u128]`, each half interpreted little-endian |
| 1 | Planned destination amount in base units, private `u128` |
| 2 | Intended Aleo recipient, private `address` |
| 3 | Wallet-derived `hyperlane-claim-secret`, private `scalar` |
| 4 | Recipient freezelist exclusion proofs |

The SDK rereads `claimable` before wallet authorization; a source transaction
receipt or Hyperlane message id is not required when the mapping shows funds.
Accepted claims complete the transfer. Rejected claims return to destination
authorization so the same identity can be retried. A missing or insufficient
balance does not prove a claim succeeded. External or partial claims require
the caller to retain their transaction evidence; the SDK does not infer
completion from an empty mapping.

Local accounts pass `hyperlane: { secretNonce, merkleProof }` to `complete`, with
a scalar and recipient proof literal. The SDK verifies that the scalar and
recipient reproduce the original BHP256 commitment before submission. No scalar
is defaulted, issued, or stored automatically for Hyperlane.

Save every `onCheckpoint` value. Checkpoints retain the encoding with the intent
and submitted source/destination transaction ids; they exclude scalar nonces,
derived-input requests, and proofs. `recover({ checkpoint })` restores the
original encoding and checks the Aleo mapping before requesting source history.
A checkpoint containing only the original intent and reviewed route can recover
a funded private claim. Source clients and Circle's attestation API are not
required for this path. Submitted destination claim ids are checked first;
unknown or pending transactions never authorize another claim.

A present zero balance retains the encoding as recovery evidence and prevents
source resubmission. `resume` also rereads the mapping when a destination client
is configured, so stale approval progress cannot redispatch a recognized
encoding. A zero balance does not establish completed delivery. When the mapping
is absent and source clients and saved transactions are available, recovery can
still observe or resume the existing source approval flow. Source approvals
reuse the same commitment. The application remains responsible for wallet
identity backup and durable checkpoint storage.

See [the executable example](../examples/private-hyperlane.ts). It quotes by
default and requires `execute: true` to move funds.


## Discover encodings by their existing counters

`readHyperlaneClaimableAmount(registry, clients, { routeId, addressEncoding })`
returns the reviewed warp route's u128 balance in destination base units, or
`null` for an absent entry. A present `0n` entry can identify a previously used
encoding even though it has no spendable balance. This evidence is read directly
from Aleo, without querying Circle or a Hyperlane explorer.

If the encoding or counter association was lost, the original wallet host or
local account can re-derive candidate encodings and check them against the
mapping:

```ts
import { scanHyperlaneAddressEncodings } from '@provablehq/aleo-bridge-sdk'

const result = await scanHyperlaneAddressEncodings(registry, clients, {
  routeId,
  // Re-derive existing public encodings with the original recipient, network,
  // and address_commitment_v1 scheme inside the wallet host or local account.
  deriveAddressEncoding,
  startCounter: 0,
  maxCounters: 100,
})

for (const entry of result.entries) {
  // Retain counter-to-encoding associations in the original identity store.
  // Only positive balances can fund a claim; reread before authorization.
  console.log(entry.counter, entry.addressEncoding, entry.claimableAmount)
}
// Pass result.nextCounter as startCounter for the next bounded scan, if defined.
```

The derivation callback MUST reproduce existing encodings. Do not use
`requestAddressEncoding` to scan: each issuance reserves a fresh identity.
Do not substitute xReserve's legacy program-scoped nonce derivation for the
generic address-commitment scheme. Derivation keys and secret nonces remain in
the caller's wallet host or local account; the scan handles only public encodings.
The mapping confirms an encoding's presence but cannot reveal its secret.

Scans continue across unused counters and include recognized zero balances.
Defaults are counter zero and 100 checks per call; `maxCounters` must be between
1 and 100,000. `nextCounter` is only a scan continuation, not a counter-allocation
watermark. Network or derivation failures stop the scan and propagate to the
caller instead of being treated as absent entries. Cancellation is checked
between derivations and reads. Discovery never issues, consumes, or releases an
identity, submits a claim, or caches mutable balances.


## Account for private outbound transfer fees

`transfer_remote_private` is a separate eleven-input outbound ABI. The SDK's
current execution helpers submit only public `transfer_remote` or
`transfer_remote_as_signer` calls. The private fee helper below provides
read-only accounting; it does not enable private outbound execution.

Bridge quotes read Aleo or the source protocol directly. They do not fetch
quotes from wallet-services-api. Existing public Aleo Hyperlane quotes report
their public hook gas payment and leave Aleo execution fees unknown.

For a reviewed private outbound deployment, use
`hyperlane.aleo.quotePrivateTransfer(publicClient, { registry, plan })`.
The plan's amount is the **gross** token record spend. The helper reads the
selected warp's fee mapping and applies:

```text
protocol_fee = floor(gross_amount * fee_bps / 10000)
net_amount = gross_amount - protocol_fee
```

The calculation splits quotient and remainder to match the bounded u128
contract arithmetic. Rates must be between 0 and 9999 bps. The fee is included
in the gross token record spend; do not add it to that record requirement.
`amountOut` and `destinationAmountAtomic` report the net destination amount,
including downward truncation when converting to fewer remote decimals.

The newer local testnet example at
[aleo-dev-toolkit commit c8b413b](https://github.com/ProvableHQ/aleo-dev-toolkit/blob/c8b413bef975e736d9c9f52d4f4ce6113f8846ae/examples/react-app/src/lib/hyperlaneAleoTestnet.ts)
reads `private_transfer_fee_bps__[false]`. The older shield-core reference reads
`private_transfer_fee_bps[true]`. The SDK does not guess between them. In addition
to existing reviewed outbound router, hook, gas, and decimal metadata, the
injected route must explicitly provide:

| Field | Required value |
| --- | --- |
| `aleoPrivateTransferAbi` | `transfer_remote_private_v1` |
| `aleoPrivateTransferCommit` | Lowercase 40-character upstream commit pinning the verified private deployment |
| `aleoPrivateTransferFeeMapping` | Exact deployed fee mapping, such as `private_transfer_fee_bps__` |
| `aleoPrivateTransferFeeKey` | Exact boolean key, such as `false` |

Only an absent entry in that reviewed mapping means zero. Failed reads,
malformed u16 values, and rates of 10000 bps or more reject the quote. Each call
reads the rate again; mutable fee values are not cached. The bundled registry
has no private-outbound ABI activation metadata.

```ts
const privateQuote = await hyperlane.aleo.quotePrivateTransfer(publicClient, {
  registry,
  plan,
})

console.log({
  grossTokenRecord: privateQuote.tokenRecordAmountAtomic,
  includedTokenFee: privateQuote.protocolFeeAtomic,
  netDestinationTokens: privateQuote.destinationAmountAtomic,
  dispatchCreditsRecord: privateQuote.dispatchCreditsRecordMicrocredits,
  executionFee: privateQuote.executionFeeMicrocredits, // null until authorized pricing
})
```

Private dispatch invokes both the effective application hook (custom hook, or
the default when none is selected) and the required mailbox hook. The helper
reads their hook types and current gas configurations, sums both payments, and
counts both invocations even when the same hook is used twice. No-op and
Merkle-tree hooks add no credits payment; gas-paymaster hooks use the on-chain
formula and the 50000 gas-limit fallback. Unsupported hook types, missing
configuration, or u128/u64 arithmetic overflow reject the quote.

The token record must cover the gross amount. The dispatch credits record must
cover the summed hook payments. Aleo execution fees are separate and remain
unknown in an unauthenticated fee quote, so `totalMicrocredits` stays null.
`planHyperlanePrivateTransferFees` can add a separately priced execution fee to
the credits budget. When paying execution fees privately, its credits record
must be distinct from the record consumed by private dispatch.

An execution integration MUST reread the fee and revalidate the reviewed
metadata, hooks, allowances, record funding, and net amount before authorization.
Supply the freshly checked fee rate at input 10 and sender exclusion proofs at
input 9. The inbound claim's secret at input 3 is unrelated to this outbound
call. Existing public transfer builders do not accept private mode and must not
be used to submit `transfer_remote_private`.
