# private.fun Design Spec

A demo dapp showing cross-chain funding to and from Aleo, with Aleo as the privacy home base and Solana/Ethereum as tactical spend chains. Three multi-wallet ecosystems composed side-by-side, two utility flows, one cross-chain applet.

Built on `@veil/core` and `@veil/bridge`.

## Goals

- Demonstrate cross-chain bridging between Aleo and Solana/Ethereum, in both directions, using mainnet routes the bridge actually supports.
- Showcase the three ecosystems' multi-wallet abstractions side-by-side: `@veil/wallet-adapter` (Aleo), `@solana/wallet-adapter-react` (Solana), `wagmi` + `viem` (Ethereum).
- Provide one cross-chain applet (anonymous pump.fun launch) that composes the utility flows + an external SDK (`@pump-fun/pump-sdk`).
- Keep recipes (the cross-chain logic) as pure functions with structured-JSON in/out, so they can be wrapped as MCP tools / skills in a follow-up without rewriting.

## Non-Goals

- No new key management primitives. External wallets hold their own keys.
- No on-chain Aleo programs beyond what already exists (no shielded keystore in v1).
- No Polymarket / pUSD integration.
- No MCP / skill tooling in v1. Recipes are shaped to allow it later.
- No testnet support — the bridge does not currently route to or from Aleo testnet.
- No headless / agent mode UI in v1. Recipes remain callable, but no MCP server ships with the app.

## Networks

Hardcoded to mainnets:

- Aleo: mainnet (the only network where the bridge operates).
- Solana: mainnet-beta.
- Ethereum: mainnet (chain id 1).

A user connected to a non-matching network on any wallet sees a "switch network" prompt. wagmi exposes `useSwitchChain`; Solana adapter exposes the cluster endpoint; Shield switches via its own UI.

## Architecture

Three provider components nested at the app root; each ecosystem exposes hooks the recipes consume.

```
<AleoWalletProvider>           {/* @veil/wallet-adapter — Shield + future Aleo wallets */}
  <SolanaWalletProvider>       {/* @solana/wallet-adapter-react */}
    <WagmiProvider>            {/* wagmi + viem */}
      <App />
    </WagmiProvider>
  </SolanaWalletProvider>
</AleoWalletProvider>
```

Pages call recipes; recipes are pure functions taking signer interfaces. No global state owns the cross-chain logic.

## Package Layout

```
apps/private-fun/
├── package.json                 # private app, not published
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/
│   ├── main.tsx                 # provider chain
│   ├── App.tsx                  # router + nav
│   ├── lib/
│   │   ├── chains.ts            # SOL / ETH / USDC asset config, decimals, explorers
│   │   ├── bridge-client.ts     # singleton @veil/bridge client
│   │   ├── recipes/
│   │   │   ├── fund-out.ts      # Aleo → external account on SOL / ETH (any asset bridge supports)
│   │   │   ├── bridge-in.ts     # external account → shielded Aleo record
│   │   │   └── pump-launch.ts   # composes fund-out + pump-sdk createAndBuyInstructions
│   │   └── wallets/
│   │       ├── useAleoSigner.ts
│   │       ├── useSolanaSigner.ts
│   │       └── useEthereumSigner.ts
│   ├── pages/
│   │   ├── FundOut.tsx          # utility 1
│   │   ├── BridgeIn.tsx         # utility 2
│   │   └── PumpLaunch.tsx       # applet
│   └── components/
│       ├── WalletConnect.tsx    # three-pane connect — shows each adapter's UI
│       ├── EthereumConnectModal.tsx  # custom modal on bare wagmi
│       ├── AccountPicker.tsx    # account selector within a connected wallet
│       ├── NetworkGuard.tsx     # wraps children, blocks until on correct network
│       ├── QuoteList.tsx        # bridge.getQuotes results + pick
│       └── ChainPicker.tsx
└── tests/
```

`pump-private` from the prior plan collapses into `recipes/pump-launch.ts` — no longer a sub-package, just one recipe.

## Recipe Shapes

Each recipe is a pure function. Parameters are typed signers — the recipe doesn't care which concrete wallet they came from.

### `fund-out.ts`

```typescript
type FundOutParameters = {
  bridge: BridgeClient
  aleoWallet: WalletClient       // @veil/core WalletClient
  aleoRecord: string             // credits.record plaintext to spend
  destination: {
    chain: 'solana' | 'ethereum'
    asset: 'SOL' | 'ETH' | 'USDC'
    address: string              // external wallet's address
    amount: string               // decimal string
  }
  selectQuote?: 'best' | 'fastest' | ((quotes: BridgeQuote[]) => BridgeQuote)
  onStage?: (status: BridgeOrderStatusDto) => void
}

type FundOutResult = {
  orderId: string
  depositTxId: string            // Aleo tx
  finalStatus?: BridgeOrderStatusDto
}
```

Implementation: delegates to `bridge.swap`. The chain/asset translates to `bridge.swap`'s `to` field.

### `bridge-in.ts`

```typescript
type BridgeInParameters = {
  bridge: BridgeClient
  source: {
    chain: 'solana' | 'ethereum'
    asset: 'SOL' | 'ETH' | 'USDC'
    address: string
    amount: string
    /** Signer for the source-chain deposit. */
    signTransaction:
      | { kind: 'solana'; signer: SolanaSigner }
      | { kind: 'ethereum'; walletClient: ViemWalletClient }
  }
  recipientAleoAddress: string
  selectQuote?: 'best' | 'fastest' | ((quotes: BridgeQuote[]) => BridgeQuote)
  onStage?: (status: BridgeOrderStatusDto) => void
}

type BridgeInResult = {
  orderId: string
  depositTxHash: string          // source-chain tx hash
  finalStatus?: BridgeOrderStatusDto
}
```

Implementation: calls `bridge.getQuotes` + `bridge.createOrder` directly (not `swap`, since `swap` is Aleo-source only), builds + signs the source-chain deposit with the provided signer, then `bridge.waitForOrder`.

### `pump-launch.ts`

```typescript
type PumpLaunchParameters = {
  bridge: BridgeClient
  aleoWallet: WalletClient
  aleoRecord: string
  /** Fresh Solana account (no prior history) the user has created in their Solana wallet. */
  creator: { publicKey: string; signTransaction: SolanaTxSigner }
  totalSol: string               // amount to bridge over for launch + initial buy + fees
  initialBuySol: string
  metadata: { name: string; symbol: string; imageUri: string; description?: string }
  onStage?: (status: BridgeOrderStatusDto) => void
}

type PumpLaunchResult = {
  tokenMint: string
  creatorAddress: string
  pumpfunUrl: string
  bridgeOrderId: string
  solanaTxSignature: string
}
```

Implementation:
1. Pin metadata to IPFS (Pinata client, key in env).
2. Call `fund-out` with `to: { chain: 'solana', asset: 'SOL', address: creator.publicKey, amount: totalSol }`, `poll: 'COMPLETED'`.
3. Build `pump-sdk.createAndBuyInstructions`, sign + send with `creator.signTransaction`.
4. Return structured result.

## Pages

Each page is a thin shell — form + state + one recipe call. No business logic in components.

- **FundOut.tsx**: form picks `destination.chain`, `destination.asset`, `destination.amount`, `destination.address` (from connected Solana/Ethereum wallet via `AccountPicker`), selects an Aleo record to spend. Calls `fund-out`. Shows quote selection + bridge progress.
- **BridgeIn.tsx**: form picks `source.chain`, `source.asset`, `source.amount`, `source.address` (from connected wallet). Calls `bridge-in`. Shows quote, source-chain deposit signature step, then bridge progress.
- **PumpLaunch.tsx**: form for token metadata + initial buy size. The Solana wallet's "create new account" affordance is highlighted in copy ("for maximum unlinkability, use a fresh Solana account"). Calls `pump-launch`. Shows full lifecycle.

## Wallet Connect UX

- **Aleo**: Whatever modal `@veil/wallet-adapter` exposes; defaults to Shield.
- **Solana**: `@solana/wallet-adapter-react-ui` modal — standard, no customization.
- **Ethereum**: custom modal on bare wagmi — small list of available connectors (`injected`, `walletConnect`, `coinbaseWallet`) with their names + icons. ~80 lines.

Auto-connect is enabled on all three providers (each adapter persists last-used wallet to localStorage).

## Network Guards

`NetworkGuard` wraps each page; checks the relevant wallet's current network against the hardcoded mainnet target for that flow. On mismatch:

- Solana / Ethereum: show a "switch network" CTA that calls the wallet's switch action.
- Aleo: show instructions pointing at Shield's settings (no programmatic switch).

## Dependencies

Top-level adds to `apps/private-fun/package.json`:

| Package | Purpose |
|---|---|
| `@veil/core` (workspace) | Aleo client, wallet types |
| `@veil/bridge` (workspace) | Cross-chain bridge |
| `@veil/wallet-adapter` (workspace) | Aleo wallet abstraction |
| `react`, `react-dom`, `react-router-dom` | UI shell |
| `vite`, `@vitejs/plugin-react`, `typescript` | Build |
| `@solana/wallet-adapter-react`, `@solana/wallet-adapter-react-ui`, `@solana/wallet-adapter-wallets`, `@solana/web3.js` | Solana stack |
| `wagmi`, `viem` | Ethereum stack |
| `@pump-fun/pump-sdk`, `@coral-xyz/anchor` | pump.fun launch |
| Pinata SDK (or `pinata-web3`) | IPFS pinning for token metadata |

No new packages added to the Veil monorepo's published surface — `private-fun` is consumer-only.

## Error Handling

Recipes throw typed errors from `@veil/bridge` (`BridgeError` family) plus a small set of recipe-level errors (`InvalidAccountError`, `MetadataPinError`). Pages catch and surface — no global error boundary heroics required for v1.

## Open Questions (deferred until v1)

- **Bridge support for USDC routes.** Aleo↔Solana for USDC-SPL and Aleo↔Ethereum for USDC-ERC20 depend on the WSA provider catalog. v1 enumerates the asset list but falls back gracefully when no quotes come back. Verified against the live API during implementation.
- **IPFS pinning key.** Pinata API key lives in env. For local dev, the README explains how to obtain one. Public hosting is out of scope for v1.
- **Network-aware bridge client config.** Single mainnet endpoint for `httpBridge` baseUrl. If staging/prod URLs differ, env-config later.
- **Cross-wallet balance aggregation page.** Nice-to-have "portfolio view" combining balances from all three connected wallets. Deferred; the per-page wallet status banner is enough for v1.

## Reference: how this differs from the original pump-private-demo

| Aspect | Original | v1 |
|---|---|---|
| Scope | pump.fun anonymous launch only | Two utilities + pump-launch applet |
| Key storage | Local Solana keypair in browser | External wallet — user creates fresh Solana account in their wallet |
| Wallets | Implicit (in-process Keypair) | Three multi-wallet adapters demonstrated side-by-side |
| Networks | Devnet | Mainnet only |
| Local package | `pump-private` subdir | Collapses into `recipes/pump-launch.ts` |
| Agent mode | MCP server option | Deferred; recipe shapes preserve it for v2 |
