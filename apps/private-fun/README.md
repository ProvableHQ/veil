# @veil/private-fun

Demo dapp for cross-chain funding to and from Aleo, with three multi-wallet ecosystems composed side-by-side.

## What it does

- **Fund out** — bridge ALEO / wrapped assets / USDCX / USAD from Aleo to Solana, Ethereum, Base, or Arbitrum.
- **Bridge in** — bridge SOL / ETH / USDC / USDT / WBTC from any of those chains into a shielded Aleo record.
- **Pump launch** (applet) — anonymous pump.fun token launch funded by a bridged ALEO → SOL transfer.

## Architecture

- `@veil/core` — Aleo client, wallet types.
- `@veil/bridge` — wallet-services-api bridge client (quotes, orders, swap, waitForOrder, MCP tool wrappers).
- `@veil/react` — Aleo wallet provider + `useVeilWallet` hook (Shield + any future Aleo wallets via the standard adapter).
- `@solana/wallet-adapter-react` — Solana side (Phantom, Solflare, etc.).
- `wagmi` + `viem` — Ethereum side (injected, Coinbase Wallet, WalletConnect).
- pump.fun `@pump-fun/pump-sdk` — for the launch applet.

Recipes (`src/lib/recipes/`) are pure functions taking typed signer interfaces; pages are thin shells that wire forms to recipes.

## Required env

Create `.env.local`:

```
VITE_WSA_BASE_URL=https://wallet.api.provable.com
VITE_PINATA_JWT=<jwt for pinata pin>
VITE_SOLANA_RPC=https://api.mainnet-beta.solana.com
VITE_WALLET_CONNECT_PROJECT_ID=<from cloud.walletconnect.com>
```

- `VITE_WSA_BASE_URL` — defaults to Provable's prod wallet-services-api (`https://wallet.api.provable.com`). Override only for staging / local dev.
- `VITE_PINATA_JWT` — only required to launch pump.fun coins; otherwise IPFS pinning fails when you try.
- `VITE_SOLANA_RPC` — defaults to Solana's public mainnet-beta endpoint. Set a private RPC for production use.
- `VITE_WALLET_CONNECT_PROJECT_ID` — optional. Without it, WalletConnect is disabled but injected wallets and Coinbase Wallet still work.

## Develop

```
pnpm install
pnpm --filter @veil/private-fun dev
```

Then open the URL Vite prints (default `http://localhost:5173`).

## Test

```
pnpm --filter @veil/private-fun exec vitest run
```

Six recipe tests cover `fundOut`, `bridgeIn`, and `pumpLaunch` with mocked bridge + wallet dependencies.

## Networks

All flows operate on mainnet (Aleo mainnet, Solana mainnet-beta, Ethereum / Base / Arbitrum mainnet). The bridge does not route to testnets.

## Adding an applet

1. Drop a page component under `src/pages/applets/` (or anywhere in `src/pages/`).
2. Add an entry to `src/lib/applets.ts`:
   ```typescript
   {
     slug: 'my-applet',
     title: 'My applet',
     icon: '✨',
     description: 'Short description.',
     component: MyApplet,
   }
   ```
3. The sidebar and `/applets` landing pick it up automatically. `App.tsx` iterates the manifest to register routes.
