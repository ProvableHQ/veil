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

read -s EVM_PRIVATE_KEY
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
read -s ALEO_PRIVATE_KEY
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

read -s ALEO_PRIVATE_KEY
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
