---
'@provablehq/aleo-bridge-sdk': minor
'@provablehq/veil-core': minor
'@provablehq/veil-aleo-sdk': minor
---

Replace flat executor and RPC configuration with registry-keyed EVM, Solana,
and Aleo clients. Add browser-wallet, viem-client, and local-key adapters,
live Solana fee and rent reads, and expiry-aware confirmation. Every client
has a public client by default, while wallet actions require the optional
wallet client explicitly in their signatures. Fund-moving actions expose optional
compact, versioned checkpoint hooks. Local Aleo flows checkpoint fully proved
transactions before source or destination broadcast; other wallet APIs
checkpoint submitted identifiers. Checkpoints exclude private-mint secrets.
The read-only `recover({ checkpoint })` action returns an explicit `wait`, `resume`,
`complete`, `done`, or `failed` next step without resubmitting funds. Each bridge decorator action now has its own module,
with protocol mechanics isolated behind internal helpers. Call builders compute
wallet inputs without network access and remain standalone utilities rather
than bridge client methods.
Registry discovery actions are exported directly as `getAssets` and `getRoutes`.
The protocol-neutral lifecycle is now `prepare`, `quote`, `execute`,
`getStatus`, `waitForStatus`, `wait`, `recover`, `resume`, and `complete`. `prepare` selects structured
source and destination assets with an optional `bridgeProtocol` constraint;
encoded route ids are outputs rather than caller input. Private inbound
xReserve transfers expose an explicit destination-action state, and `complete`
submits exactly one caller-authorized Aleo mint. Native Veil wallet clients pass
directly to `createAleoClient`, while protocol-specific escape hatches remain
exported under the `hyperlane` and `xreserve` namespaces.
Quoting and execution dispatch from the prepared route, replacing chain- and
protocol-specific client methods and the longer transfer-suffixed names.
Add deterministic recovery journeys and independently gated, minimum-amount
mainnet suites for xReserve and Hyperlane routes using local accounts.
Include Solana rent in executable quotes, expose honest Aleo Hyperlane fee
limits, enforce the xReserve withdrawal fee, and verify Aleo-origin delivery
from configured destination clients. Hyperlane inbound waits now verify the
message id against the destination Aleo Mailbox `deliveries` mapping instead
of treating an explorer index as canonical. Solana submissions align blockhash
reads and transaction preflight at confirmed commitment, and expiry checks use
canonical blockhash validity instead of provider-reported block heights. Add proving lifecycle events to core and
make delegated `writeContract` proving return an unbroadcast transaction for
the configured Aleo transport to submit. Delegated FeeMaster payment now
defaults to disabled and must be opted into explicitly.
Export `DEFAULT_SOLANA_RPC_URL` for the official Solana mainnet endpoint.
Rewrite every bridge example and the Solana deposit operator script around the
structured route and recoverable lifecycle APIs, with application-owned optional
checkpoint persistence and no imports from protocol-internal utilities.
Use visible minimum transfer amounts and fixed execution defaults in the bridge
examples, and document the complete lifecycle in a tutorial with runnable route
commands and recovery guidance.
Teach client construction, planning, quoting, execution, and recovery beside the
corresponding example code. The Aleo-to-Ethereum xReserve example now stops at
the supported source-confirmation boundary instead of attempting unsupported
destination delivery polling.
Rewrite bridge action documentation around the caller's cross-chain lifecycle,
including when funds move, when wallet authorization is required, which calls
contact networks or providers, and what recovery information applications own.
Document helper side effects and annotate protocol encodings, authorization
boundaries, irreversible submissions, provider handoffs, and retry-safe
recovery behavior for maintainers and independent implementations.
Revamp every bridge example comment around the caller-visible transfer outcome,
custody changes, wallet boundaries, settlement authority, and safe recovery after
an uncertain post-broadcast result. Provider-managed xReserve mint examples now
stop at the attestation boundary instead of waiting for an unverifiable delivery.
