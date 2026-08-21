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
export ATTESTATION_POLL_INTERVAL_MS='10000'
export ATTESTATION_TIMEOUT_MS='1800000'
```

The monitor is observational. Closing it does not cancel or pause the confirmed
deposit, Circle attestation, or automatic Aleo public/record mint. If monitoring
times out, the script prints the direct Circle URL that can be queried later.
An attestation proves that Circle signed the deposit payload; the example does
not yet locate and confirm the resulting Aleo mint transaction.
