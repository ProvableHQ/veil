# Ethereum USDC to Aleo USDCx

`usdc-to-usdcx.ts` exercises the mainnet bridge client against Circle xReserve.
It quotes the transfer without submitting by default. A live execution may send
an exact USDC approval followed by the irreversible xReserve deposit.

Set the inputs without putting the private key directly in shell history:

```sh
export ETHEREUM_RPC_URL='https://eth-mainnet.g.alchemy.com/public'
export ALEO_RECIPIENT='aleo1...'
export USDC_AMOUNT='3'
export USDCX_MINT_MODE='record'

printf 'Ethereum Private Key: '
read -rs EVM_PRIVATE_KEY
echo
export EVM_PRIVATE_KEY
```

`EVM_PRIVATE_KEY` accepts exactly 64 hexadecimal characters with or without a
`0x` prefix. It is used only for local Ethereum transaction signing. The Aleo
recipient—not the private key—is serialized into xReserve's Aleo `bytes32`
wire representation by the bridge client.

## Private mint

When `USDCX_MINT_MODE='private'`, the script also requires the private key for
the account named by `ALEO_RECIPIENT`. Enter it without placing it in shell
history:

```sh
printf 'Aleo Private Key: '
read -rs ALEO_PRIVATE_KEY
echo
export ALEO_PRIVATE_KEY
```

The private recipient commitment uses `0scalar` by default. To select a secret
nonce without placing it in shell history, enter either a decimal value or a
complete Aleo scalar literal:

```sh
read -s USDCX_SECRET_NONCE
export USDCX_SECRET_NONCE
# Accepted examples: 123 or 123scalar
```

The same scalar is used to construct the Ethereum deposit's hook data and the
later Aleo `private_mint` call. Keep a custom value secret and available until
the private mint has been submitted. The preflight reports whether the default
or a custom value is selected without printing the custom scalar.

For an enabled private-mode execution, the script loads
`@provablehq/veil-aleo-sdk`. Before the Ethereum deposit, it derives the Aleo
signer, requires its address to equal `ALEO_RECIPIENT`, and authenticates
delegated proving. After Circle attests, it submits
`shielded_usdcx_wrapper.aleo/private_mint` and polls the Aleo transaction until
accepted, rejected, or timed out. A read-only quote does not load the Aleo SDK
or require `ALEO_PRIVATE_KEY`. The example does not configure a record scanner
or attempt to locate or decrypt the resulting private record.

Private-mode defaults and optional overrides are:

```sh
export ALEO_RPC_URL='https://api.provable.com/v2'
export ALEO_PROVING_MODE='delegated'
export ALEO_USE_FEE_MASTER='true'
export ALEO_PRIVATE_FEE='false'
export ALEO_EXECUTION_CONFIRMATION_TIMEOUT_MS='300000'
export ALEO_TRANSACTION_POLL_INTERVAL_MS='5000'
export ALEO_TRANSACTION_TIMEOUT_MS='300000'
```

Private mint always uses delegated proving. The wrapper circuit is too large
for the local WASM proving path's practical memory limits. While DPS is proving,
the script prints a progress message every 15 seconds; the Aleo transaction id
becomes available after DPS broadcasts it and the SDK confirms acceptance.

### Resume an existing private deposit

If the process exits after the Ethereum deposit, do not rerun the deposit command.
Set the Circle message hash printed by the original run to bypass Ethereum and
submit only the Aleo private mint. `USDC_AMOUNT`, `ETHEREUM_RPC_URL`, and
`EVM_PRIVATE_KEY` are not used in resume mode.

```sh
export USDCX_MINT_MODE='private'
export ALEO_RECIPIENT='aleo1...'
export XRESERVE_RESUME_MESSAGE_HASH='0x...'

# Set this to the same custom scalar used for the deposit; omit it for 0scalar.
read -s USDCX_SECRET_NONCE
export USDCX_SECRET_NONCE

# Read-only: verifies Circle's payload and the recipient/scalar commitment.
pnpm tsx examples/bridge/usdc-to-usdcx.ts

printf 'Aleo Private Key: '
read -rs ALEO_PRIVATE_KEY
echo
export ALEO_PRIVATE_KEY

# After reviewing the resume preflight:
EXECUTE_XRESERVE_PRIVATE_MINT=I_UNDERSTAND_THIS_SUBMITS_AN_ALEO_PRIVATE_MINT \
  pnpm tsx examples/bridge/usdc-to-usdcx.ts
```

The resume path fetches Circle's signed payload, derives the deposited amount,
and recomputes the private hook from the recipient and scalar. A mismatch fails
before the Aleo signer or delegated prover submits anything.

Delegated mode automatically registers a process-lifetime Provable API consumer
when credentials are omitted. For an existing consumer, set both
`ALEO_CONSUMER_ID` and `ALEO_DPS_API_KEY`. `ALEO_PROVER_URL` optionally selects
a different delegated prover base URL.

Run the read-only preflight:

```sh
pnpm tsx examples/bridge/usdc-to-usdcx.ts
```

Review the sender, balance, allowance, recipient, hook data, fee ceiling, and
xReserve contract. Then explicitly enable the live approval and deposit:

```sh
EXECUTE_XRESERVE_DEPOSIT=I_UNDERSTAND_THIS_MOVES_REAL_FUNDS \
  pnpm tsx examples/bridge/usdc-to-usdcx.ts
```

The route requires at least 2 USDC and ETH for gas. `public` and `record` mints
are completed by the Aleo-side service. `private` requires a later user-signed
`shielded_usdcx_wrapper.aleo/private_mint` transaction after Circle attests the
deposit.

After the Ethereum deposit confirms, the script polls Circle every 10 seconds
for up to 30 minutes. These defaults can be changed before execution:

```sh
export EVM_CONFIRMATION_TIMEOUT_MS='300000'
export ATTESTATION_POLL_INTERVAL_MS='10000'
export ATTESTATION_TIMEOUT_MS='1800000'
```

The EVM confirmation timeout applies independently to each submitted approval
or deposit. If an approval remains pending when that timeout expires, the script
states that no deposit or Circle message exists and exits safely. Once the
approval confirms, rerun with the same recipient and secret scalar; the next
quote observes the allowance and skips the approval.

For public and record modes, the monitor is observational: closing it does not
cancel or pause the confirmed deposit, Circle attestation, or automatic Aleo
mint. For private mode, closing before `private_mint` is submitted leaves the
deposit attested but unminted until an Aleo signer resumes that step. If Circle
monitoring times out, the script prints the direct URL that can be queried later.
An attestation proves that Circle signed the deposit payload; public and record
mint confirmation still requires Aleo-side discovery.

# Aleo USDCx to Ethereum USDC

`usdcx-to-usdc.ts` prepares a mainnet xReserve withdrawal and submits it only
after an explicit acknowledgement. Private burn is the default; set
`USDCX_BURN_MODE='public'` to burn the Aleo signer's public USDCx balance
instead.

```sh
export USDCX_AMOUNT='3'
export ETHEREUM_RECIPIENT='0x...'

# Optional; private is the default.
export USDCX_BURN_MODE='private'

pnpm tsx examples/bridge/usdcx-to-usdc.ts
```

Private burn does not require the caller to paste a record. During execution,
the example attaches Provable's record scanner to the local wallet client,
requests the account's unspent `usdcx_stablecoin.aleo/Token` records, and passes
the smallest record covering the burn amount to the bridge. The private key and
decrypted record stay in the local process. If no single record covers the
amount, join records before retrying.

The wrapper also requires the current `[MerkleProof; 2]` non-inclusion witness
for its compliance list. The example fetches the live tree from
`usdcx_freezelist.aleo/compliance/freeze-list` and uses the Provable SDK's
`SealanceMerkleTree` to derive the witness for the Aleo signer immediately
before submission. Supply the Aleo and Provable API credentials used for
proving and record scanning:

```sh
printf 'Aleo Private Key: '
read -rs ALEO_PRIVATE_KEY
echo
export ALEO_PRIVATE_KEY

export ALEO_CONSUMER_ID='...'
read -s ALEO_DPS_API_KEY
export ALEO_DPS_API_KEY

EXECUTE_XRESERVE_BURN=I_UNDERSTAND_THIS_BURNS_USDCX \
  pnpm tsx examples/bridge/usdcx-to-usdc.ts
```

For a public withdrawal, the script calls `burn_public_as_signer`; neither a
record scanner nor an exclusion proof is used:

```sh
export USDCX_BURN_MODE='public'
printf 'Aleo Private Key: '
read -rs ALEO_PRIVATE_KEY
echo
export ALEO_PRIVATE_KEY

EXECUTE_XRESERVE_BURN=I_UNDERSTAND_THIS_BURNS_USDCX \
  pnpm tsx examples/bridge/usdcx-to-usdc.ts
```

Delegated proving is the default. `ALEO_RPC_URL`, `ALEO_PROVER_URL`,
`ALEO_USE_FEE_MASTER`, `ALEO_PRIVATE_FEE`, and
`ALEO_EXECUTION_CONFIRMATION_TIMEOUT_MS` use the same meanings as the deposit
example. Once Aleo accepts the burn, the operated burn-attestation service
forwards it to Circle; no Ethereum transaction is submitted by this script.

# Ethereum Hyperlane to Aleo

`eth-to-aleo.ts` and `wbtc-to-aleo.ts` exercise the reviewed mainnet Ethereum
Hyperlane Warp Routes. Both scripts quote without submitting by default and use
a local viem account when execution is explicitly enabled. ETH dispatches in a
single transaction. WBTC checks its Warp Route allowance and submits an exact
approval only when the existing allowance is insufficient.

Set the shared inputs and enter the Ethereum private key without placing it in
shell history:

```sh
export ETHEREUM_RPC_URL='https://eth-mainnet.g.alchemy.com/public'
export ALEO_RECIPIENT='aleo1...'
printf 'Ethereum Private Key: '
read -rs EVM_PRIVATE_KEY
echo
export EVM_PRIVATE_KEY
```

For the native ETH read-only preflight:

```sh
export ETH_AMOUNT='0.001'
pnpm tsx examples/bridge/eth-to-aleo.ts
```

After reviewing the recipient encoding, live Hyperlane fee, total transaction
value, balance, and Warp Route contract, explicitly enable the ETH transfer:

```sh
EXECUTE_HYPERLANE_ETH=I_UNDERSTAND_THIS_MOVES_REAL_FUNDS \
  pnpm tsx examples/bridge/eth-to-aleo.ts
```

For the WBTC read-only preflight:

```sh
export WBTC_AMOUNT='0.0001'
pnpm tsx examples/bridge/wbtc-to-aleo.ts
```

After reviewing the WBTC balance, allowance, approval requirement, native ETH
fee, recipient encoding, and contracts, explicitly enable the WBTC transfer:

```sh
EXECUTE_HYPERLANE_WBTC=I_UNDERSTAND_THIS_MOVES_REAL_FUNDS \
  pnpm tsx examples/bridge/wbtc-to-aleo.ts
```

`EVM_PRIVATE_KEY` accepts exactly 64 hexadecimal characters with or without a
`0x` prefix. It signs locally and is not sent to Veil or the RPC service. Both
routes require ETH for Ethereum gas and the quoted Hyperlane interchain fee.
The ETH route's transaction value includes the bridged ETH amount plus that
fee; the WBTC route's transaction value contains only the native fee.

Each submitted Ethereum transaction is allowed five minutes to confirm by
default. Override that interval when needed:

```sh
export EVM_CONFIRMATION_TIMEOUT_MS='600000'
```

If a WBTC approval times out, the transfer is not submitted. After the approval
confirms, rerun the same live command; the client sees the sufficient allowance
and proceeds without approving again. If the transfer itself times out, use the
printed Ethereum hash to check its state before rerunning, since the dispatch
may already have been broadcast.

# Aleo WBTC to Ethereum WBTC

`wbtc-to-ethereum.ts` exercises the return journey through
`hyp_warp_token_wbtc_v2.aleo/transfer_remote_as_signer`. The Aleo Warp Route
burns public `arc20_wbtc.aleo`; private WBTC records must be unshielded before
using this example. No record scanner is configured.

Set the amount, Ethereum recipient, and Aleo signer:

```sh
export WBTC_AMOUNT='0.0001'
export ETHEREUM_RECIPIENT='0x...'

printf 'Aleo Private Key: '
read -rs ALEO_PRIVATE_KEY
echo
export ALEO_PRIVATE_KEY
```

Run the read-only preflight:

```sh
pnpm tsx examples/bridge/wbtc-to-ethereum.ts
```

The preflight reads the signer's public Aleo WBTC and credits balances. It also
quotes the current `hyp_hook_manager.aleo/destination_gas_configs` entry with
`quoteAleoHyperlaneGasPayment`, which returns the exact public-credits
allowance consumed by the Interchain Gas Paymaster. The example asserts that
this live allowance is WBTC's only unresolved field and passes the quote to
execution as `gasPaymentMicrocredits`.

After reviewing the amount, Ethereum recipient, balances, and hook payment:

```sh
EXECUTE_HYPERLANE_WBTC_RETURN=I_UNDERSTAND_THIS_MOVES_REAL_FUNDS \
  pnpm tsx examples/bridge/wbtc-to-ethereum.ts
```

The hook payment is requoted immediately before proving. Delegated proving is
the default; `ALEO_CONSUMER_ID`, `ALEO_DPS_API_KEY`, `ALEO_RPC_URL`,
`ALEO_PROVER_URL`, `ALEO_USE_FEE_MASTER`, `ALEO_PRIVATE_FEE`, and
`ALEO_EXECUTION_CONFIRMATION_TIMEOUT_MS` are optional overrides. The hook
payment always comes from public credits even when FeeMaster pays the Aleo
transaction fee. Hyperlane relayers deliver the accepted message and release
WBTC on Ethereum independently of this process.

# Aleo ETH to Ethereum ETH

`eth-to-ethereum.ts` uses the same return runner for public
`arc20_eth.aleo`. It fetches the live IGP configuration for the ETH route's
`44000u128` gas limit, checks the public Aleo ETH and credits balances, and
calls `hyp_warp_token_eth_v2.aleo/transfer_remote_as_signer`. Private ETH
records must be unshielded first; no record scanner is used.

```sh
export ETH_AMOUNT='0.001'
export ETHEREUM_RECIPIENT='0x...'

printf 'Aleo Private Key: '
read -rs ALEO_PRIVATE_KEY
echo
export ALEO_PRIVATE_KEY

# Read-only preflight
pnpm tsx examples/bridge/eth-to-ethereum.ts
```

After reviewing the Ethereum recipient, public ETH balance, public credits
balance, and live hook payment:

```sh
EXECUTE_HYPERLANE_ETH_RETURN=I_UNDERSTAND_THIS_MOVES_REAL_FUNDS \
  pnpm tsx examples/bridge/eth-to-ethereum.ts
```

The hook payment is requoted immediately before proving. The accepted Aleo
transaction burns the specified public ETH; Hyperlane relayers release native
ETH to the Ethereum recipient asynchronously.

# Solana SOL to Aleo SOL

`sol-to-aleo.ts` plans `hyperlane:solana/sol->aleo/sol` with Veil, reads the
deployed native SOL Warp Route and IGP accounts, and constructs the transfer
with Hyperlane's Solana Kit-native codecs. The read-only path needs only the
sender's public address; it quotes the hook and network fees and runs an
unsigned Solana simulation. It does not create a replayable signature.

```sh
export SOLANA_RPC_URL='https://api.mainnet-beta.solana.com'
export SOLANA_SENDER='...'
export ALEO_RECIPIENT='aleo1...'
export SOL_AMOUNT='0.01'

pnpm tsx examples/bridge/sol-to-aleo.ts
```

The output includes the native SOL balance, Hyperlane hook payment, Solana
transaction fee, total required balance, Warp Route program, and Aleo
destination domain. A production RPC endpoint is recommended because Solana's
public endpoint is rate-limited.

To submit, enter either a base58-encoded 64-byte Solana keypair or the JSON byte
array stored by the Solana CLI. The derived address must match `SOLANA_SENDER`
when both are set.

```sh
printf 'Solana Private Key: '
read -rs SOLANA_PRIVATE_KEY
echo
export SOLANA_PRIVATE_KEY

EXECUTE_HYPERLANE_SOL=I_UNDERSTAND_THIS_MOVES_REAL_FUNDS \
  pnpm tsx examples/bridge/sol-to-aleo.ts
```

Execution signs locally with `@solana/kit`, simulates the signed transaction,
submits it, and waits for confirmed or finalized status. The accepted source
transaction locks native SOL in the Warp Route; Hyperlane relayers mint SOL to
the Aleo recipient asynchronously. `SOLANA_CONFIRMATION_TIMEOUT_MS` optionally
overrides the two-minute confirmation timeout.

# Aleo SOL to Solana SOL

`sol-to-solana.ts` exercises the return route through
`hyp_warp_token_sol_v2.aleo/transfer_remote_as_signer`. It burns public
`arc20_sol.aleo`; private SOL records must be unshielded before using this
example. No record scanner or Solana private key is required because the source
transaction is signed on Aleo.

```sh
export SOL_AMOUNT='0.01'
export SOLANA_RECIPIENT='...'

printf 'Aleo Private Key: '
read -rs ALEO_PRIVATE_KEY
echo
export ALEO_PRIVATE_KEY

# Read-only preflight
pnpm tsx examples/bridge/sol-to-solana.ts
```

The preflight validates the Solana recipient, reads the signer's public SOL and
credits balances, and calculates the live Hyperlane hook payment from
`hyp_hook_manager.aleo/destination_gas_configs`. No SOL is burned unless the
execution acknowledgement is set:

```sh
EXECUTE_HYPERLANE_SOL_RETURN=I_UNDERSTAND_THIS_MOVES_REAL_FUNDS \
  pnpm tsx examples/bridge/sol-to-solana.ts
```

The hook payment is requoted immediately before proving. The accepted Aleo
transaction burns the specified public SOL; Hyperlane relayers release native
SOL to the Solana recipient asynchronously.
