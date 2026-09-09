# @provablehq/aleo-bridge-cli

The `aleo-bridge` command previews and executes the bridge journeys reviewed in
Veil's bridge examples. It supports Circle xReserve for USDC/USDCx and
Hyperlane Warp Routes for ETH, WBTC, and SOL.

Install it globally, or as a project dependency:

```sh
npm install -g @provablehq/aleo-bridge-cli
aleo-bridge routes
```

Every transfer is a dry run unless `--execute` is present. Use key files rather
than placing private keys or API keys in command arguments:

```sh
aleo-bridge transfer \
  --route arc-to-aleo \
  --amount 5 \
  --recipient aleo1... \
  --rpc-url https://rpc.testnet.arc.network \
  --private-key-file ~/.config/aleo-bridge/arc.key \
  --mint-mode private \
  --aleo-private-key-file ~/.config/aleo-bridge/aleo.key

# After reviewing the preview:
aleo-bridge transfer ... --execute
```

The command reads a trimmed secret from each file. Restrict those files to your
user account, for example with `chmod 600 <file>`, and never commit them.

## Routes

`aleo-bridge routes` lists the friendly route names accepted by `transfer`.
`aleo-bridge routes --json` returns the same registry as JSON.

| Route | Journey | Protocol |
| --- | --- | --- |
| `arc-to-aleo` | Arc USDC → Aleo USDCx | xReserve |
| `usdc-to-usdcx` | Ethereum USDC → Aleo USDCx | xReserve |
| `usdcx-to-usdc` | Aleo USDCx → Ethereum USDC | xReserve |
| `eth-to-aleo` | Ethereum ETH → Aleo ETH | Hyperlane |
| `wbtc-to-aleo` | Ethereum WBTC → Aleo WBTC | Hyperlane |
| `eth-to-ethereum` | Aleo ETH → Ethereum ETH | Hyperlane |
| `wbtc-to-ethereum` | Aleo WBTC → Ethereum WBTC | Hyperlane |
| `sol-to-aleo` | Solana SOL → Aleo SOL | Hyperlane |
| `sol-to-solana` | Aleo SOL → Solana SOL | Hyperlane |

You may use the full SDK route ID shown by `routes` instead of its friendly
name. Amounts are human-readable units, not base units.

## Delivery modes and signers

Ethereum xReserve accepts `--mint-mode public`, `record`, or `private`; Arc
accepts `public` or `private`. Private minting needs a separate Aleo signer
supplied with `--aleo-private-key-file`. If delegated proving is used, also provide
`--consumer-id` and `--api-key-file`. A private-mint nonce can be supplied with
`--secret-nonce-file`.

The outbound `usdcx-to-usdc` route accepts `--burn-mode private` or `public`.
Its `--private-key-file` is the Aleo signer. The same is true for all routes
whose source chain is Aleo; Ethereum and Arc routes expect an EVM key, and the
Solana route accepts either a Solana key or `--sender` for a read-only preview.

An xReserve deposit whose attestation completed but whose private mint did not
can be resumed without another deposit:

```sh
aleo-bridge transfer \
  --route arc-to-aleo \
  --recipient aleo1... \
  --mint-mode private \
  --resume-message-hash 0x... \
  --aleo-private-key-file ~/.config/aleo-bridge/aleo.key \
  --consumer-id "$ALEO_CONSUMER_ID" \
  --api-key-file ~/.config/aleo-bridge/provable-api.key \
  --execute
```

Run `aleo-bridge transfer --help` for all flags. `--verbose` preserves the
underlying example's protocol diagnostics when that runner supports them.

## Running from this repository

```sh
pnpm install
pnpm aleo-bridge routes
pnpm aleo-bridge transfer --route eth-to-aleo --amount 0.01 \
  --recipient aleo1... --rpc-url https://... --private-key-file ./evm.key
```

To exercise the packaged binary:

```sh
pnpm --filter @provablehq/aleo-bridge-cli build
node packages/bridge-cli/dist/index.js routes
```

These are mainnet bridge routes and `--execute` can move real funds. Always run
the preview first and verify the sender, recipient, amount, fees, and route.
