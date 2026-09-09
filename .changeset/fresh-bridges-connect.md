---
'@provablehq/aleo-bridge-sdk': minor
---

Replace flat executor and RPC configuration with registry-keyed EVM, Solana,
and Aleo connections. Add browser-wallet, viem-client, and local-key adapters,
live Solana fee and rent reads, and expiry-aware confirmation. Every connection
has a public client by default, while `*WalletConnection` types refine the
optional wallet capability. Source execution exposes durable submission
checkpoint hooks, and xReserve and Solana confirmation resume from checkpoints
without resubmitting funds.
