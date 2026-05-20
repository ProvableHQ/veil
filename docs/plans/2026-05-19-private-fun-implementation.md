# private.fun Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/private-fun/` — a demo dapp showing cross-chain funding to and from Aleo with three multi-wallet ecosystems composed side-by-side. Two utility flows (FundOut, BridgeIn) plus one applet (PumpLaunch).

**Architecture:** React + Vite app on top of `@veil/core` + `@veil/bridge` + `@veil/react` (for Aleo wallet), `@solana/wallet-adapter-*` (for Solana), and `wagmi` + `viem` (for Ethereum). Recipes are pure functions taking typed signer interfaces; pages are thin shells.

**Spec:** [`docs/specs/2026-05-18-private-fun-design.md`](../specs/2026-05-18-private-fun-design.md)

**Reference conventions** (from `apps/loyalty-dapp`):
- Vite + React 19 + TS, `"type": "module"`
- `vite.config.ts` aliases workspace package source files
- `tsconfig.json` extends repo root, sets `jsx: "react-jsx"`, includes `vite/client` types

---

## Task 1: App scaffold

**Files:**
- Create: `apps/private-fun/package.json`
- Create: `apps/private-fun/tsconfig.json`
- Create: `apps/private-fun/vite.config.ts`
- Create: `apps/private-fun/index.html`
- Create: `apps/private-fun/src/main.tsx`
- Create: `apps/private-fun/src/App.tsx`
- Create: `apps/private-fun/src/app.css`

- [ ] **Step 1: `apps/private-fun/package.json`**

```json
{
  "name": "@veil/private-fun",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@veil/core": "workspace:*",
    "@veil/bridge": "workspace:*",
    "@veil/react": "workspace:*",
    "@veil/wallet-adapter": "workspace:*",
    "@solana/wallet-adapter-base": "^0.9.23",
    "@solana/wallet-adapter-react": "^0.15.36",
    "@solana/wallet-adapter-react-ui": "^0.9.36",
    "@solana/wallet-adapter-wallets": "^0.19.33",
    "@solana/web3.js": "^1.98.0",
    "@pump-fun/pump-sdk": "^1.35.0",
    "@coral-xyz/anchor": "^0.31.1",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0",
    "viem": "^2.21.0",
    "wagmi": "^2.14.0",
    "@tanstack/react-query": "^5.59.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: `apps/private-fun/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "noEmit": true,
    "types": ["vite/client"],
    "paths": {
      "@veil/core": ["../../packages/core/src/index.ts"],
      "@veil/bridge": ["../../packages/bridge/src/index.ts"],
      "@veil/react": ["../../packages/react/src/index.ts"],
      "@veil/wallet-adapter": ["../../packages/wallet-adapter/src/index.ts"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 3: `apps/private-fun/vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@veil/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
      '@veil/bridge': path.resolve(__dirname, '../../packages/bridge/src/index.ts'),
      '@veil/react': path.resolve(__dirname, '../../packages/react/src/index.ts'),
      '@veil/wallet-adapter': path.resolve(__dirname, '../../packages/wallet-adapter/src/index.ts'),
    },
  },
})
```

- [ ] **Step 4: `apps/private-fun/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>private.fun</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: `apps/private-fun/src/main.tsx`**

```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 6: `apps/private-fun/src/App.tsx`** (placeholder, real version in Task 12)

```typescript
export function App() {
  return <div>private.fun (scaffolding)</div>
}
```

- [ ] **Step 7: `apps/private-fun/src/app.css`** (minimal reset; full styling deferred)

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }
```

- [ ] **Step 8: Verify scaffold builds**

Run from repo root: `pnpm install`
Expected: `@veil/private-fun` registered. New dependencies install.

Run: `pnpm --filter @veil/private-fun typecheck`
Expected: PASS.

Run: `pnpm --filter @veil/private-fun build`
Expected: PASS, `dist/` produced.

- [ ] **Step 9: Commit**

```bash
git add apps/private-fun
git commit -m "scaffold @veil/private-fun app"
```
NO Co-Authored-By.

---

## Task 2: Chains config + bridge client singleton

**Files:**
- Create: `apps/private-fun/src/lib/chains.ts`
- Create: `apps/private-fun/src/lib/bridge-client.ts`

- [ ] **Step 1: `apps/private-fun/src/lib/chains.ts`**

```typescript
/**
 * Asset and chain metadata for the private.fun UI. The values here drive the
 * chain/asset pickers; the bridge API ultimately decides which routes have
 * live quotes at any moment.
 */

export type ExternalChain = 'solana' | 'ethereum' | 'base' | 'arbitrum'

export type ExternalAsset =
  | 'SOL'
  | 'ETH'
  | 'USDC'
  | 'USDT'
  | 'WBTC'

export type AleoAssetSymbol = 'ALEO' | 'WBTC' | 'WETH' | 'WUSDC' | 'WSOL' | 'USDCX' | 'USAD'

export type ChainConfig = {
  symbol: ExternalChain
  displayName: string
  /** EVM chain id; null for non-EVM. */
  evmChainId: number | null
  /** Explorer URL prefix; concat with tx hash for a deep link. */
  explorerTxPrefix: string
  /** Supported assets on this chain that the bridge can route. */
  assets: ExternalAsset[]
}

export const CHAIN_CONFIGS: Readonly<Record<ExternalChain, ChainConfig>> = Object.freeze({
  solana: {
    symbol: 'solana',
    displayName: 'Solana',
    evmChainId: null,
    explorerTxPrefix: 'https://solscan.io/tx/',
    assets: ['SOL', 'USDC'],
  },
  ethereum: {
    symbol: 'ethereum',
    displayName: 'Ethereum',
    evmChainId: 1,
    explorerTxPrefix: 'https://etherscan.io/tx/',
    assets: ['ETH', 'USDC', 'USDT', 'WBTC'],
  },
  base: {
    symbol: 'base',
    displayName: 'Base',
    evmChainId: 8453,
    explorerTxPrefix: 'https://basescan.org/tx/',
    assets: ['ETH', 'USDC', 'USDT', 'WBTC'],
  },
  arbitrum: {
    symbol: 'arbitrum',
    displayName: 'Arbitrum',
    evmChainId: 42161,
    explorerTxPrefix: 'https://arbiscan.io/tx/',
    assets: ['USDC', 'USDT', 'WBTC'],
  },
})

export const ALEO_EXPLORER_TX_PREFIX = 'https://explorer.aleo.org/transaction/'

/** Map an Aleo-side asset symbol to the matching external asset for sanity-check pairing. */
export const ALEO_TO_EXTERNAL_ASSET: Readonly<Record<AleoAssetSymbol, ExternalAsset | 'ALEO'>> = Object.freeze({
  ALEO: 'ALEO',
  WBTC: 'WBTC',
  WETH: 'ETH',
  WUSDC: 'USDC',
  WSOL: 'SOL',
  USDCX: 'USDC',
  USAD: 'USDC',
})
```

- [ ] **Step 2: `apps/private-fun/src/lib/bridge-client.ts`**

```typescript
import { createBridgeClient, httpBridge, type BridgeClient } from '@veil/bridge'

const WSA_BASE_URL = import.meta.env.VITE_WSA_BASE_URL ?? 'https://wallet-services.provable.com/api'

let cached: BridgeClient | null = null

export function getBridgeClient(): BridgeClient {
  if (!cached) {
    cached = createBridgeClient({
      transport: httpBridge(WSA_BASE_URL),
    })
  }
  return cached
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @veil/private-fun typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/private-fun/src/lib
git commit -m "add chains config and bridge-client singleton"
```

---

## Task 3: `fund-out` recipe

**Files:**
- Create: `apps/private-fun/src/lib/recipes/fund-out.ts`
- Create: `apps/private-fun/test/recipes/fund-out.test.ts`

- [ ] **Step 1: Write failing test `apps/private-fun/test/recipes/fund-out.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { fundOut } from '../../src/lib/recipes/fund-out.js'
import type { WalletClient } from '@veil/core'
import type { BridgeClient } from '@veil/bridge'

function makeBridge(quoteOutAmounts: string[], orderId = 'o1', stages = ['COMPLETED']): BridgeClient {
  let pollI = 0
  const request = vi.fn().mockImplementation(async ({ method }: { method: string }) => {
    if (method === 'getBridgeQuotes') {
      return {
        data: quoteOutAmounts.map((amount, i) => ({
          provider: { id: 'p1', code: 'demo', displayName: 'Demo', capabilities: [] },
          quoteId: `q${i}`,
          srcChain: 'aleo',
          destChain: 'solana',
          srcAsset: 'ALEO',
          destAsset: 'SOL',
          amountIn: '1',
          amountOut: amount,
        })),
        meta: { count: quoteOutAmounts.length, quoteRequestId: 'req-1' },
      }
    }
    if (method === 'createBridgeOrder') {
      return {
        data: {
          orderId,
          depositAddress: 'aleo1deposit',
          depositAmount: '1500000',
          depositChain: 'aleo',
          instructions: { type: 'ONCHAIN_DEPOSIT', address: 'aleo1deposit', amount: '1500000', chain: 'aleo' },
        },
      }
    }
    if (method === 'getBridgeOrder') {
      return {
        data: {
          orderId,
          provider: { id: 'p1', code: 'demo', displayName: 'Demo', capabilities: [] },
          status: stages[Math.min(pollI++, stages.length - 1)],
          timeline: [],
          createdAt: '2026-05-19T00:00:00Z',
          updatedAt: '2026-05-19T00:00:00Z',
        },
      }
    }
    throw new Error(`unexpected method ${method}`)
  })
  // Return a duck-typed BridgeClient — only `swap` is used by fund-out, plus the underlying request.
  // We construct a real bound client via the package surface in production; for the unit test
  // we just need the actions reachable.
  const client = { request } as unknown as BridgeClient
  // We need the action methods bound. Easiest: build a partial that calls the imported functions.
  // But to avoid coupling tests to the decorator, just import swap directly.
  return Object.assign(client, {
    swap: vi.fn().mockResolvedValue({
      quoteRequestId: 'req-1',
      orderId,
      depositTxId: 'at1deadbeef',
      finalStatus: stages[stages.length - 1] === 'COMPLETED'
        ? {
            orderId,
            provider: { id: 'p1', code: 'demo', displayName: 'Demo', capabilities: [] },
            status: 'COMPLETED',
            timeline: [],
            createdAt: '2026-05-19T00:00:00Z',
            updatedAt: '2026-05-19T00:00:00Z',
          }
        : undefined,
    }),
  }) as BridgeClient
}

function makeWallet(): WalletClient {
  return {
    account: { type: 'rpc', address: 'aleo1sender', sign: vi.fn() },
    request: vi.fn(),
  } as unknown as WalletClient
}

describe('fundOut', () => {
  it('delegates to bridge.swap with the destination chain/asset/address translated correctly', async () => {
    const bridge = makeBridge(['0.05'])
    const wallet = makeWallet()

    const result = await fundOut({
      bridge,
      aleoWallet: wallet,
      destination: { chain: 'solana', asset: 'SOL', address: '8xJ...', amount: '1.5' },
      sourceAsset: 'ALEO',
    })

    expect(result.orderId).toBe('o1')
    expect(result.depositTxId).toBe('at1deadbeef')

    expect(bridge.swap).toHaveBeenCalledWith(expect.objectContaining({
      wallet,
      from: { asset: 'ALEO', amount: '1.5' },
      to: { chain: 'solana', asset: 'SOL', address: '8xJ...' },
    }))
  })

  it('passes through selectQuote, merkleProof, and poll options', async () => {
    const bridge = makeBridge(['0.05'])
    const wallet = makeWallet()
    const selectQuote = vi.fn()
    const onStage = vi.fn()

    await fundOut({
      bridge,
      aleoWallet: wallet,
      destination: { chain: 'ethereum', asset: 'USDC', address: '0xdest', amount: '100' },
      sourceAsset: 'USDCX',
      merkleProof: 'mp-input',
      selectQuote,
      poll: 'COMPLETED',
      onStage,
    })

    expect(bridge.swap).toHaveBeenCalledWith(expect.objectContaining({
      from: { asset: 'USDCX', amount: '100' },
      to: { chain: 'ethereum', asset: 'USDC', address: '0xdest' },
      merkleProof: 'mp-input',
      selectQuote,
      poll: 'COMPLETED',
      onStage,
    }))
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `pnpm vitest run apps/private-fun/test/recipes/fund-out.test.ts` from repo root.
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/private-fun/src/lib/recipes/fund-out.ts`**

```typescript
import type { WalletClient } from '@veil/core'
import type {
  BridgeClient,
  BridgeOrderStage,
  BridgeOrderStatusDto,
  BridgeQuote,
  SwapReturnType,
} from '@veil/bridge'
import type { AleoAssetSymbol, ExternalAsset, ExternalChain } from '../chains.js'

export type FundOutParameters = {
  bridge: BridgeClient
  aleoWallet: WalletClient
  /** Source asset on the Aleo side. Determines which Aleo program is used for the unshield deposit. */
  sourceAsset: AleoAssetSymbol
  /** Destination chain, asset, and address on the external chain. */
  destination: {
    chain: ExternalChain
    asset: ExternalAsset | 'ETH' | 'SOL'
    address: string
    amount: string
  }
  /** Merkle proof input. Required only for compliance-bearing source assets (USDCX, USAD). */
  merkleProof?: string
  selectQuote?:
    | 'best'
    | 'fastest'
    | ((quotes: BridgeQuote[]) => BridgeQuote | Promise<BridgeQuote>)
  poll?: boolean | BridgeOrderStage
  timezone?: string
  onStage?: (status: BridgeOrderStatusDto) => void
}

export type FundOutResult = SwapReturnType

export async function fundOut(params: FundOutParameters): Promise<FundOutResult> {
  return params.bridge.swap({
    wallet: params.aleoWallet,
    from: { asset: params.sourceAsset, amount: params.destination.amount },
    to: {
      chain: params.destination.chain,
      asset: params.destination.asset,
      address: params.destination.address,
    },
    merkleProof: params.merkleProof,
    selectQuote: params.selectQuote,
    poll: params.poll,
    timezone: params.timezone,
    onStage: params.onStage,
  })
}
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm vitest run apps/private-fun/test/recipes/fund-out.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/private-fun/src/lib/recipes/fund-out.ts apps/private-fun/test/recipes/fund-out.test.ts
git commit -m "add fund-out recipe and tests"
```

---

## Task 4: `bridge-in` recipe

**Files:**
- Create: `apps/private-fun/src/lib/recipes/bridge-in.ts`
- Create: `apps/private-fun/test/recipes/bridge-in.test.ts`

The `bridge-in` recipe calls bridge primitives directly (not `swap`, since swap is Aleo-source only). It expects the dapp to handle the source-chain deposit signature itself; the recipe returns the `BridgeOrderInstructions` plus a helper to wait for completion.

- [ ] **Step 1: Write failing test**

```typescript
// apps/private-fun/test/recipes/bridge-in.test.ts
import { describe, it, expect, vi } from 'vitest'
import { bridgeIn } from '../../src/lib/recipes/bridge-in.js'
import type { BridgeClient } from '@veil/bridge'

function makeBridge(): BridgeClient {
  const client = {
    request: vi.fn(),
    getQuotes: vi.fn().mockResolvedValue({
      quotes: [{
        provider: { id: 'p1', code: 'demo', displayName: 'Demo', capabilities: [] },
        quoteId: 'q1',
        srcChain: 'solana',
        destChain: 'aleo',
        srcAsset: 'SOL',
        destAsset: 'WSOL',
        amountIn: '0.5',
        amountOut: '0.49',
      }],
      meta: { count: 1, quoteRequestId: 'req-1' },
    }),
    createOrder: vi.fn().mockResolvedValue({
      orderId: 'o1',
      depositAddress: '8xJ_bridge_deposit',
      depositAmount: '500000000',
      depositChain: 'solana',
      instructions: {
        type: 'ONCHAIN_DEPOSIT',
        address: '8xJ_bridge_deposit',
        amount: '500000000',
        chain: 'solana',
      },
    }),
    waitForOrder: vi.fn().mockResolvedValue({
      orderId: 'o1',
      provider: { id: 'p1', code: 'demo', displayName: 'Demo', capabilities: [] },
      status: 'COMPLETED',
      timeline: [],
      createdAt: '2026-05-19T00:00:00Z',
      updatedAt: '2026-05-19T00:00:00Z',
    }),
  }
  return client as unknown as BridgeClient
}

describe('bridgeIn', () => {
  it('returns quote + instructions for the caller to deposit + wait helper', async () => {
    const bridge = makeBridge()
    const result = await bridgeIn({
      bridge,
      source: { chain: 'solana', asset: 'SOL', address: '8xJ_sender', amount: '0.5' },
      destinationAsset: 'WSOL',
      recipientAleoAddress: 'aleo1recipient',
    })

    expect(result.quote.quoteId).toBe('q1')
    expect(result.instructions.depositAddress).toBe('8xJ_bridge_deposit')
    expect(typeof result.waitForCompletion).toBe('function')

    expect(bridge.getQuotes).toHaveBeenCalledWith(expect.objectContaining({
      srcChain: 'solana',
      srcAsset: 'SOL',
      destChain: 'aleo',
      destAsset: 'WSOL',
      amountIn: '0.5',
      recipientAddress: 'aleo1recipient',
    }))
    expect(bridge.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'p1',
      quoteId: 'q1',
      srcChain: 'solana',
      destChain: 'aleo',
      srcAsset: 'SOL',
      destAsset: 'WSOL',
      amountIn: '0.5',
      walletAddress: '8xJ_sender',
    }))
  })

  it('waitForCompletion calls bridge.waitForOrder with the order id', async () => {
    const bridge = makeBridge()
    const result = await bridgeIn({
      bridge,
      source: { chain: 'solana', asset: 'SOL', address: '8xJ_sender', amount: '0.5' },
      destinationAsset: 'WSOL',
      recipientAleoAddress: 'aleo1recipient',
    })

    const status = await result.waitForCompletion()
    expect(status.status).toBe('COMPLETED')
    expect(bridge.waitForOrder).toHaveBeenCalledWith(expect.objectContaining({
      id: 'o1',
      until: 'COMPLETED',
    }))
  })

  it('throws if no quotes are returned', async () => {
    const bridge = makeBridge()
    ;(bridge.getQuotes as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      quotes: [],
      meta: { count: 0, quoteRequestId: 'req' },
    })

    await expect(bridgeIn({
      bridge,
      source: { chain: 'ethereum', asset: 'USDC', address: '0xsender', amount: '100' },
      destinationAsset: 'WUSDC',
      recipientAleoAddress: 'aleo1recipient',
    })).rejects.toThrow(/no quotes/i)
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `pnpm vitest run apps/private-fun/test/recipes/bridge-in.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/private-fun/src/lib/recipes/bridge-in.ts`**

```typescript
import type {
  BridgeClient,
  BridgeOrderInstructions,
  BridgeOrderStage,
  BridgeOrderStatusDto,
  BridgeQuote,
} from '@veil/bridge'
import type { AleoAssetSymbol, ExternalAsset, ExternalChain } from '../chains.js'

export type BridgeInParameters = {
  bridge: BridgeClient
  source: {
    chain: ExternalChain
    asset: ExternalAsset | 'ETH' | 'SOL'
    /** Source-chain address (the external wallet that will sign the deposit). */
    address: string
    amount: string
  }
  /** Aleo-side asset to receive (e.g. WSOL for inbound SOL). */
  destinationAsset: AleoAssetSymbol
  /** Aleo address that will own the shielded record. */
  recipientAleoAddress: string
  /** Quote selection strategy; defaults to 'best'. */
  selectQuote?:
    | 'best'
    | 'fastest'
    | ((quotes: BridgeQuote[]) => BridgeQuote | Promise<BridgeQuote>)
  timezone?: string
}

export type BridgeInResult = {
  quote: BridgeQuote
  instructions: BridgeOrderInstructions
  /** Resolves when the bridge order reaches `until` (default COMPLETED). */
  waitForCompletion: (until?: BridgeOrderStage) => Promise<BridgeOrderStatusDto>
}

async function pickQuote(
  strategy: BridgeInParameters['selectQuote'],
  quotes: BridgeQuote[],
): Promise<BridgeQuote> {
  if (typeof strategy === 'function') return strategy(quotes)
  if (strategy === 'fastest') {
    return [...quotes].sort(
      (a, b) =>
        (a.estimatedTimeSeconds ?? Number.POSITIVE_INFINITY) -
        (b.estimatedTimeSeconds ?? Number.POSITIVE_INFINITY),
    )[0] as BridgeQuote
  }
  return [...quotes].sort((a, b) => Number(b.amountOut) - Number(a.amountOut))[0] as BridgeQuote
}

export async function bridgeIn(params: BridgeInParameters): Promise<BridgeInResult> {
  const { quotes } = await params.bridge.getQuotes({
    srcChain: params.source.chain,
    srcAsset: params.source.asset,
    destChain: 'aleo',
    destAsset: params.destinationAsset,
    amountIn: params.source.amount,
    recipientAddress: params.recipientAleoAddress,
  })
  if (quotes.length === 0) {
    throw new Error('bridgeIn: no quotes returned for the requested route')
  }
  const chosen = await pickQuote(params.selectQuote ?? 'best', quotes)
  if (!chosen.quoteId) {
    throw new Error('bridgeIn: selected quote is missing quoteId')
  }

  const instructions = await params.bridge.createOrder({
    providerId: chosen.provider.id,
    srcChain: params.source.chain,
    destChain: 'aleo',
    srcAsset: params.source.asset,
    destAsset: params.destinationAsset,
    amountIn: params.source.amount,
    walletAddress: params.source.address,
    quoteId: chosen.quoteId,
    timezone: params.timezone,
  })

  return {
    quote: chosen,
    instructions,
    waitForCompletion: (until?: BridgeOrderStage) =>
      params.bridge.waitForOrder({ id: instructions.orderId, until: until ?? 'COMPLETED' }),
  }
}
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm vitest run apps/private-fun/test/recipes/bridge-in.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/private-fun/src/lib/recipes/bridge-in.ts apps/private-fun/test/recipes/bridge-in.test.ts
git commit -m "add bridge-in recipe and tests"
```

---

## Task 5: `pump-launch` recipe

**Files:**
- Create: `apps/private-fun/src/lib/recipes/pump-launch.ts`
- Create: `apps/private-fun/test/recipes/pump-launch.test.ts`

The recipe takes a callback `pinMetadata` (so the test doesn't need a real Pinata key), a `creator` signer interface, and composes `fundOut` + `pump-sdk.createAndBuyInstructions`. The test mocks both `pinMetadata` and the pump-sdk dependency.

- [ ] **Step 1: Write failing test**

```typescript
// apps/private-fun/test/recipes/pump-launch.test.ts
import { describe, it, expect, vi } from 'vitest'
import { pumpLaunch } from '../../src/lib/recipes/pump-launch.js'
import type { WalletClient } from '@veil/core'
import type { BridgeClient } from '@veil/bridge'

function makeBridge(): BridgeClient {
  return {
    request: vi.fn(),
    swap: vi.fn().mockResolvedValue({
      quoteRequestId: 'req-1',
      orderId: 'o1',
      depositTxId: 'at1deadbeef',
      finalStatus: {
        orderId: 'o1',
        provider: { id: 'p1', code: 'demo', displayName: 'Demo', capabilities: [] },
        status: 'COMPLETED',
        timeline: [],
        createdAt: '2026-05-19T00:00:00Z',
        updatedAt: '2026-05-19T00:00:00Z',
      },
    }),
  } as unknown as BridgeClient
}

function makeAleoWallet(): WalletClient {
  return {
    account: { type: 'rpc', address: 'aleo1sender', sign: vi.fn() },
    request: vi.fn(),
  } as unknown as WalletClient
}

describe('pumpLaunch', () => {
  it('pins metadata → fund-out → launchWithCreator → returns structured result', async () => {
    const bridge = makeBridge()
    const wallet = makeAleoWallet()
    const pinMetadata = vi.fn().mockResolvedValue('ipfs://meta-cid')
    const launchWithCreator = vi.fn().mockResolvedValue({
      tokenMint: 'BvK_mint',
      solanaTxSignature: '5j2K_sig',
    })

    const result = await pumpLaunch({
      bridge,
      aleoWallet: wallet,
      creator: { publicKey: '8xJ_creator', signTransaction: vi.fn() },
      totalSol: '0.5',
      initialBuySol: '0.05',
      metadata: { name: 'DEMO', symbol: 'DEMO', imageUri: 'data:image/png;base64,xxx' },
      pinMetadata,
      launchWithCreator,
    })

    expect(pinMetadata).toHaveBeenCalledWith(expect.objectContaining({ name: 'DEMO' }))
    expect(bridge.swap).toHaveBeenCalledWith(expect.objectContaining({
      from: { asset: 'ALEO', amount: '0.5' },
      to: { chain: 'solana', asset: 'SOL', address: '8xJ_creator' },
      poll: 'COMPLETED',
    }))
    expect(launchWithCreator).toHaveBeenCalledWith(expect.objectContaining({
      creator: expect.objectContaining({ publicKey: '8xJ_creator' }),
      metadataUri: 'ipfs://meta-cid',
      initialBuySol: '0.05',
    }))
    expect(result).toEqual({
      tokenMint: 'BvK_mint',
      creatorAddress: '8xJ_creator',
      pumpfunUrl: 'https://pump.fun/coin/BvK_mint',
      bridgeOrderId: 'o1',
      solanaTxSignature: '5j2K_sig',
    })
  })
})
```

- [ ] **Step 2: Run failing test**

Run: `pnpm vitest run apps/private-fun/test/recipes/pump-launch.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `apps/private-fun/src/lib/recipes/pump-launch.ts`**

```typescript
import type { WalletClient } from '@veil/core'
import type { BridgeClient, BridgeOrderStatusDto } from '@veil/bridge'
import { fundOut } from './fund-out.js'

export type PumpMetadata = {
  name: string
  symbol: string
  imageUri: string
  description?: string
}

export type PumpCreator = {
  publicKey: string
  signTransaction: (...args: unknown[]) => Promise<unknown>
}

export type LaunchWithCreatorResult = {
  tokenMint: string
  solanaTxSignature: string
}

export type LaunchWithCreator = (input: {
  creator: PumpCreator
  metadataUri: string
  metadata: PumpMetadata
  initialBuySol: string
}) => Promise<LaunchWithCreatorResult>

export type PinMetadata = (metadata: PumpMetadata) => Promise<string>

export type PumpLaunchParameters = {
  bridge: BridgeClient
  aleoWallet: WalletClient
  creator: PumpCreator
  totalSol: string
  initialBuySol: string
  metadata: PumpMetadata
  /** Pins the metadata JSON to IPFS and returns the URI. Injected so tests can mock. */
  pinMetadata: PinMetadata
  /** Builds + signs the pump.fun createAndBuyInstructions tx. Injected so tests can mock. */
  launchWithCreator: LaunchWithCreator
  onStage?: (status: BridgeOrderStatusDto) => void
}

export type PumpLaunchResult = {
  tokenMint: string
  creatorAddress: string
  pumpfunUrl: string
  bridgeOrderId: string
  solanaTxSignature: string
}

export async function pumpLaunch(params: PumpLaunchParameters): Promise<PumpLaunchResult> {
  const metadataUri = await params.pinMetadata(params.metadata)

  const swap = await fundOut({
    bridge: params.bridge,
    aleoWallet: params.aleoWallet,
    sourceAsset: 'ALEO',
    destination: {
      chain: 'solana',
      asset: 'SOL',
      address: params.creator.publicKey,
      amount: params.totalSol,
    },
    poll: 'COMPLETED',
    onStage: params.onStage,
  })

  const launch = await params.launchWithCreator({
    creator: params.creator,
    metadataUri,
    metadata: params.metadata,
    initialBuySol: params.initialBuySol,
  })

  return {
    tokenMint: launch.tokenMint,
    creatorAddress: params.creator.publicKey,
    pumpfunUrl: `https://pump.fun/coin/${launch.tokenMint}`,
    bridgeOrderId: swap.orderId,
    solanaTxSignature: launch.solanaTxSignature,
  }
}
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm vitest run apps/private-fun/test/`
Expected: all recipe tests PASS (2 + 3 + 1 = 6 total).

- [ ] **Step 5: Commit**

```bash
git add apps/private-fun/src/lib/recipes/pump-launch.ts apps/private-fun/test/recipes/pump-launch.test.ts
git commit -m "add pump-launch recipe and tests"
```

---

## Task 6: Provider stack (Aleo + Solana + Wagmi)

**Files:**
- Modify: `apps/private-fun/src/main.tsx`
- Create: `apps/private-fun/src/lib/providers.tsx`
- Create: `apps/private-fun/src/lib/wagmi-config.ts`

- [ ] **Step 1: `apps/private-fun/src/lib/wagmi-config.ts`**

```typescript
import { http, createConfig } from 'wagmi'
import { mainnet, base, arbitrum } from 'wagmi/chains'
import { injected, walletConnect, coinbaseWallet } from 'wagmi/connectors'

const WC_PROJECT_ID = import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID ?? ''

export const wagmiConfig = createConfig({
  chains: [mainnet, base, arbitrum],
  connectors: [
    injected(),
    coinbaseWallet({ appName: 'private.fun' }),
    ...(WC_PROJECT_ID ? [walletConnect({ projectId: WC_PROJECT_ID })] : []),
  ],
  transports: {
    [mainnet.id]: http(),
    [base.id]: http(),
    [arbitrum.id]: http(),
  },
})
```

- [ ] **Step 2: `apps/private-fun/src/lib/providers.tsx`**

```typescript
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { VeilProvider } from '@veil/react'
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'
import { clusterApiUrl } from '@solana/web3.js'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from './wagmi-config.js'

const queryClient = new QueryClient()

export function PrivateFunProviders({ children }: { children: ReactNode }) {
  const solanaEndpoint = useMemo(() => clusterApiUrl('mainnet-beta'), [])
  const solanaWallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  )

  return (
    <VeilProvider network="mainnet" programs={['credits.aleo', 'token_registry.aleo']}>
      <ConnectionProvider endpoint={solanaEndpoint}>
        <WalletProvider wallets={solanaWallets} autoConnect>
          <WalletModalProvider>
            <WagmiProvider config={wagmiConfig}>
              <QueryClientProvider client={queryClient}>
                {children}
              </QueryClientProvider>
            </WagmiProvider>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </VeilProvider>
  )
}
```

- [ ] **Step 3: Update `apps/private-fun/src/main.tsx`**

```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { PrivateFunProviders } from './lib/providers.js'
import '@solana/wallet-adapter-react-ui/styles.css'
import './app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivateFunProviders>
      <App />
    </PrivateFunProviders>
  </StrictMode>,
)
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @veil/private-fun typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/private-fun/src
git commit -m "add three-wallet provider stack (Aleo + Solana + wagmi)"
```

---

## Task 7: Wallet signer hooks

**Files:**
- Create: `apps/private-fun/src/lib/wallets/useAleoSigner.ts`
- Create: `apps/private-fun/src/lib/wallets/useSolanaSigner.ts`
- Create: `apps/private-fun/src/lib/wallets/useEthereumSigner.ts`

- [ ] **Step 1: `apps/private-fun/src/lib/wallets/useAleoSigner.ts`**

```typescript
import { useVeilWallet } from '@veil/react'

/** Read the connected Aleo wallet client + address, or null when disconnected. */
export function useAleoSigner() {
  const { walletClient, address } = useVeilWallet()
  if (!walletClient || !address) return null
  return { walletClient, address }
}
```

- [ ] **Step 2: `apps/private-fun/src/lib/wallets/useSolanaSigner.ts`**

```typescript
import { useWallet } from '@solana/wallet-adapter-react'

/** Read the connected Solana wallet + address. Null when not connected. */
export function useSolanaSigner() {
  const wallet = useWallet()
  if (!wallet.publicKey || !wallet.signTransaction) return null
  return {
    publicKey: wallet.publicKey,
    signTransaction: wallet.signTransaction.bind(wallet),
    walletName: wallet.wallet?.adapter.name ?? null,
  }
}
```

- [ ] **Step 3: `apps/private-fun/src/lib/wallets/useEthereumSigner.ts`**

```typescript
import { useAccount, useChainId, useWalletClient } from 'wagmi'

/** Read the connected EVM wallet + chain id. Null when not connected. */
export function useEthereumSigner() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { data: walletClient } = useWalletClient()
  if (!isConnected || !address || !walletClient) return null
  return { address, chainId, walletClient }
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @veil/private-fun typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/private-fun/src/lib/wallets
git commit -m "add wallet signer hooks for the three ecosystems"
```

---

## Task 8: UI components (WalletConnect + EthereumConnectModal + NetworkGuard)

**Files:**
- Create: `apps/private-fun/src/components/WalletConnect.tsx`
- Create: `apps/private-fun/src/components/EthereumConnectModal.tsx`
- Create: `apps/private-fun/src/components/NetworkGuard.tsx`

The components are intentionally plain — minimal CSS, focus on demonstrating the wallet abstractions. Style polish is out of scope.

- [ ] **Step 1: `apps/private-fun/src/components/EthereumConnectModal.tsx`**

```typescript
import { useConnect } from 'wagmi'
import { useState } from 'react'

export function EthereumConnectModal() {
  const { connectors, connect, status, error } = useConnect()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button onClick={() => setOpen(true)}>Connect Ethereum wallet</button>
      {open && (
        <div role="dialog" style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ background: 'white', padding: 24, minWidth: 320 }}>
            <h3>Connect Ethereum wallet</h3>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {connectors.map((connector) => (
                <li key={connector.uid}>
                  <button onClick={() => { connect({ connector }); setOpen(false) }}>
                    {connector.name}
                  </button>
                </li>
              ))}
            </ul>
            {status === 'error' && error && <p>Error: {error.message}</p>}
            <button onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 2: `apps/private-fun/src/components/WalletConnect.tsx`**

```typescript
import { useVeilWallet } from '@veil/react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useAccount, useDisconnect } from 'wagmi'
import { EthereumConnectModal } from './EthereumConnectModal.js'

export function WalletConnect() {
  const aleo = useVeilWallet()
  const eth = useAccount()
  const { disconnect: disconnectEth } = useDisconnect()

  return (
    <div style={{ display: 'flex', gap: 12, padding: 12 }}>
      <section>
        <h4>Aleo</h4>
        {aleo.address ? (
          <span>{aleo.address.slice(0, 10)}…</span>
        ) : (
          <button onClick={() => aleo.connect()}>Connect Aleo wallet</button>
        )}
      </section>
      <section>
        <h4>Solana</h4>
        <WalletMultiButton />
      </section>
      <section>
        <h4>Ethereum</h4>
        {eth.isConnected ? (
          <>
            <span>{eth.address?.slice(0, 10)}…</span>
            <button onClick={() => disconnectEth()}>Disconnect</button>
          </>
        ) : (
          <EthereumConnectModal />
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 3: `apps/private-fun/src/components/NetworkGuard.tsx`**

```typescript
import type { ReactNode } from 'react'
import { useChainId, useSwitchChain } from 'wagmi'
import { CHAIN_CONFIGS, type ExternalChain } from '../lib/chains.js'

type Props = {
  requiredChain: ExternalChain
  children: ReactNode
}

/** Blocks rendering until the connected EVM wallet is on the right chain.
 *  For non-EVM chains (Solana) this is a no-op; cluster mismatch is shown
 *  inline elsewhere. */
export function NetworkGuard({ requiredChain, children }: Props) {
  const chainConfig = CHAIN_CONFIGS[requiredChain]
  const currentChainId = useChainId()
  const { switchChain } = useSwitchChain()

  if (chainConfig.evmChainId === null) return <>{children}</>

  if (currentChainId !== chainConfig.evmChainId) {
    return (
      <div style={{ padding: 16, border: '1px solid orange' }}>
        <p>This action requires the {chainConfig.displayName} network.</p>
        <button onClick={() => switchChain({ chainId: chainConfig.evmChainId! })}>
          Switch to {chainConfig.displayName}
        </button>
      </div>
    )
  }

  return <>{children}</>
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @veil/private-fun typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/private-fun/src/components
git commit -m "add WalletConnect, EthereumConnectModal, NetworkGuard components"
```

---

## Task 9: FundOut page

**Files:**
- Create: `apps/private-fun/src/pages/FundOut.tsx`

A minimal form: pick destination chain + asset + amount + address, source asset (defaulting to ALEO), and merkleProof (only shown for USDCX/USAD). Submits via `fundOut` recipe, shows progress via `onStage`.

- [ ] **Step 1: `apps/private-fun/src/pages/FundOut.tsx`**

```typescript
import { useState } from 'react'
import { CHAIN_CONFIGS, type AleoAssetSymbol, type ExternalAsset, type ExternalChain } from '../lib/chains.js'
import { fundOut, type FundOutResult } from '../lib/recipes/fund-out.js'
import { getBridgeClient } from '../lib/bridge-client.js'
import { useAleoSigner } from '../lib/wallets/useAleoSigner.js'

const ALEO_ASSETS: AleoAssetSymbol[] = ['ALEO', 'WBTC', 'WETH', 'WUSDC', 'WSOL', 'USDCX', 'USAD']
const COMPLIANCE_ASSETS = new Set<AleoAssetSymbol>(['USDCX', 'USAD'])

export function FundOut() {
  const aleo = useAleoSigner()

  const [sourceAsset, setSourceAsset] = useState<AleoAssetSymbol>('ALEO')
  const [destChain, setDestChain] = useState<ExternalChain>('solana')
  const [destAsset, setDestAsset] = useState<ExternalAsset | 'ETH' | 'SOL'>('SOL')
  const [destAddress, setDestAddress] = useState('')
  const [amount, setAmount] = useState('0.5')
  const [merkleProof, setMerkleProof] = useState('')
  const [status, setStatus] = useState<string>('idle')
  const [result, setResult] = useState<FundOutResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const requiresMerkleProof = COMPLIANCE_ASSETS.has(sourceAsset)

  async function submit() {
    if (!aleo) return
    setStatus('starting'); setError(null); setResult(null)
    try {
      const r = await fundOut({
        bridge: getBridgeClient(),
        aleoWallet: aleo.walletClient,
        sourceAsset,
        destination: { chain: destChain, asset: destAsset, address: destAddress, amount },
        merkleProof: requiresMerkleProof ? merkleProof : undefined,
        poll: 'COMPLETED',
        onStage: (s) => setStatus(s.status),
      })
      setResult(r)
      setStatus('completed')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('failed')
    }
  }

  if (!aleo) return <p>Connect an Aleo wallet to fund external accounts.</p>

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12, maxWidth: 480 }}>
      <h2>Fund out</h2>

      <label>
        Source asset (Aleo):
        <select value={sourceAsset} onChange={(e) => setSourceAsset(e.target.value as AleoAssetSymbol)}>
          {ALEO_ASSETS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>

      <label>
        Destination chain:
        <select value={destChain} onChange={(e) => { setDestChain(e.target.value as ExternalChain); }}>
          {Object.values(CHAIN_CONFIGS).map((c) => <option key={c.symbol} value={c.symbol}>{c.displayName}</option>)}
        </select>
      </label>

      <label>
        Destination asset:
        <select value={destAsset} onChange={(e) => setDestAsset(e.target.value as never)}>
          {CHAIN_CONFIGS[destChain].assets.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>

      <label>
        Destination address:
        <input value={destAddress} onChange={(e) => setDestAddress(e.target.value)} placeholder="external wallet address" />
      </label>

      <label>
        Amount (decimal):
        <input value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>

      {requiresMerkleProof && (
        <label>
          Merkle proof (compliance):
          <textarea value={merkleProof} onChange={(e) => setMerkleProof(e.target.value)} />
        </label>
      )}

      <button onClick={submit} disabled={!destAddress || !amount}>
        Fund {amount} {destAsset} → {destChain}
      </button>

      <div>Status: <strong>{status}</strong></div>
      {result && (
        <pre>{JSON.stringify(result, null, 2)}</pre>
      )}
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @veil/private-fun typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/private-fun/src/pages/FundOut.tsx
git commit -m "add FundOut page"
```

---

## Task 10: BridgeIn page

**Files:**
- Create: `apps/private-fun/src/pages/BridgeIn.tsx`

Mirrors FundOut but inverted: pick source chain + asset + amount + address (from connected external wallet), Aleo recipient + destination Aleo asset. Calls `bridgeIn`; user signs the source-chain deposit themselves (page surfaces the `instructions` and a "I deposited — wait for completion" CTA in v1; full source-chain signing automation is a v2 polish).

- [ ] **Step 1: `apps/private-fun/src/pages/BridgeIn.tsx`**

```typescript
import { useState } from 'react'
import { CHAIN_CONFIGS, type AleoAssetSymbol, type ExternalAsset, type ExternalChain } from '../lib/chains.js'
import { bridgeIn, type BridgeInResult } from '../lib/recipes/bridge-in.js'
import { getBridgeClient } from '../lib/bridge-client.js'
import { useAleoSigner } from '../lib/wallets/useAleoSigner.js'
import { useSolanaSigner } from '../lib/wallets/useSolanaSigner.js'
import { useEthereumSigner } from '../lib/wallets/useEthereumSigner.js'

const ALEO_ASSETS: AleoAssetSymbol[] = ['ALEO', 'WBTC', 'WETH', 'WUSDC', 'WSOL', 'USDCX', 'USAD']

export function BridgeIn() {
  const aleo = useAleoSigner()
  const solana = useSolanaSigner()
  const eth = useEthereumSigner()

  const [sourceChain, setSourceChain] = useState<ExternalChain>('solana')
  const [sourceAsset, setSourceAsset] = useState<ExternalAsset | 'ETH' | 'SOL'>('SOL')
  const [destAsset, setDestAsset] = useState<AleoAssetSymbol>('WSOL')
  const [amount, setAmount] = useState('0.5')
  const [status, setStatus] = useState('idle')
  const [result, setResult] = useState<BridgeInResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sourceAddress =
    sourceChain === 'solana' ? solana?.publicKey.toBase58() :
    sourceChain === 'ethereum' || sourceChain === 'base' || sourceChain === 'arbitrum' ? eth?.address :
    undefined

  if (!aleo) return <p>Connect an Aleo wallet to receive shielded assets.</p>

  async function getOrder() {
    if (!sourceAddress) {
      setError(`Connect a ${sourceChain} wallet first`)
      return
    }
    setStatus('fetching quote'); setError(null)
    try {
      const r = await bridgeIn({
        bridge: getBridgeClient(),
        source: { chain: sourceChain, asset: sourceAsset, address: sourceAddress, amount },
        destinationAsset: destAsset,
        recipientAleoAddress: aleo.address,
      })
      setResult(r)
      setStatus('awaiting deposit')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('failed')
    }
  }

  async function pollUntilDone() {
    if (!result) return
    setStatus('polling')
    try {
      const final = await result.waitForCompletion()
      setStatus(final.status)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('failed')
    }
  }

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12, maxWidth: 480 }}>
      <h2>Bridge in</h2>

      <label>
        Source chain:
        <select value={sourceChain} onChange={(e) => { setSourceChain(e.target.value as ExternalChain) }}>
          {Object.values(CHAIN_CONFIGS).map((c) => <option key={c.symbol} value={c.symbol}>{c.displayName}</option>)}
        </select>
      </label>

      <label>
        Source asset:
        <select value={sourceAsset} onChange={(e) => setSourceAsset(e.target.value as never)}>
          {CHAIN_CONFIGS[sourceChain].assets.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>

      <label>
        Destination asset on Aleo:
        <select value={destAsset} onChange={(e) => setDestAsset(e.target.value as AleoAssetSymbol)}>
          {ALEO_ASSETS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </label>

      <label>
        Amount:
        <input value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>

      <p>Source wallet: {sourceAddress ?? '(not connected)'}</p>
      <p>Aleo recipient: {aleo.address}</p>

      <button onClick={getOrder} disabled={!sourceAddress || !amount}>
        Get bridge quote + order
      </button>

      {result && (
        <div>
          <h3>Deposit instructions</h3>
          <p>Send <strong>{result.instructions.depositAmount}</strong> of {result.quote.srcAsset} on {result.quote.srcChain} to:</p>
          <code>{result.instructions.depositAddress}</code>
          {result.instructions.depositMemo && <p>Memo: <code>{result.instructions.depositMemo}</code></p>}
          <p>Sign + send the deposit with your {sourceChain} wallet, then click below to wait for completion.</p>
          <button onClick={pollUntilDone}>I deposited — wait for completion</button>
        </div>
      )}

      <div>Status: <strong>{status}</strong></div>
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @veil/private-fun typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/private-fun/src/pages/BridgeIn.tsx
git commit -m "add BridgeIn page"
```

---

## Task 11: PumpLaunch page

**Files:**
- Create: `apps/private-fun/src/pages/PumpLaunch.tsx`
- Create: `apps/private-fun/src/lib/pin-metadata.ts`
- Create: `apps/private-fun/src/lib/launch-with-creator.ts`

`pin-metadata.ts` posts to Pinata if `VITE_PINATA_JWT` is set; otherwise rejects with a clear error. `launch-with-creator.ts` builds + sends `pump-sdk.createAndBuyInstructions`.

- [ ] **Step 1: `apps/private-fun/src/lib/pin-metadata.ts`**

```typescript
import type { PumpMetadata } from './recipes/pump-launch.js'

const PINATA_JWT = import.meta.env.VITE_PINATA_JWT ?? ''

export async function pinMetadataToIpfs(metadata: PumpMetadata): Promise<string> {
  if (!PINATA_JWT) {
    throw new Error('VITE_PINATA_JWT not set — required for IPFS pinning')
  }
  const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PINATA_JWT}`,
    },
    body: JSON.stringify({ pinataContent: metadata }),
  })
  if (!response.ok) {
    throw new Error(`Pinata pin failed: HTTP ${response.status}`)
  }
  const json = (await response.json()) as { IpfsHash: string }
  return `ipfs://${json.IpfsHash}`
}
```

- [ ] **Step 2: `apps/private-fun/src/lib/launch-with-creator.ts`**

```typescript
import { Connection, PublicKey, Transaction, type Signer } from '@solana/web3.js'
import { PumpSdk } from '@pump-fun/pump-sdk'
import type { LaunchWithCreator } from './recipes/pump-launch.js'

const SOLANA_RPC = import.meta.env.VITE_SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com'

export const launchWithCreator: LaunchWithCreator = async ({ creator, metadataUri, metadata, initialBuySol }) => {
  const conn = new Connection(SOLANA_RPC)
  const pump = new PumpSdk(conn as unknown as never)
  const mint = new PublicKey(creator.publicKey)  // pump-sdk generates mint internally in some versions; treat as opaque
  const instructions = await pump.createAndBuyInstructions({
    creator: new PublicKey(creator.publicKey),
    mint,
    name: metadata.name,
    symbol: metadata.symbol,
    metadataUri,
    initialBuySol: BigInt(Math.floor(Number(initialBuySol) * 1_000_000_000)),
  } as never)
  const tx = new Transaction().add(...(instructions as never[]))
  const signed = await creator.signTransaction(tx as unknown as never) as Transaction
  const sig = await conn.sendRawTransaction(signed.serialize())
  await conn.confirmTransaction(sig, 'confirmed')
  return { tokenMint: mint.toBase58(), solanaTxSignature: sig }
}
```

Note: pump-sdk's exact signature varies across versions; the above is illustrative. Adjust the call to match the installed `@pump-fun/pump-sdk` API at implementation time. The key contract is: it produces a tx that creates the token under `creator.publicKey` and does the initial buy.

- [ ] **Step 3: `apps/private-fun/src/pages/PumpLaunch.tsx`**

```typescript
import { useState } from 'react'
import { pumpLaunch, type PumpLaunchResult } from '../lib/recipes/pump-launch.js'
import { getBridgeClient } from '../lib/bridge-client.js'
import { useAleoSigner } from '../lib/wallets/useAleoSigner.js'
import { useSolanaSigner } from '../lib/wallets/useSolanaSigner.js'
import { pinMetadataToIpfs } from '../lib/pin-metadata.js'
import { launchWithCreator } from '../lib/launch-with-creator.js'

export function PumpLaunch() {
  const aleo = useAleoSigner()
  const solana = useSolanaSigner()

  const [name, setName] = useState('PRIVATE')
  const [symbol, setSymbol] = useState('PVT')
  const [imageUri, setImageUri] = useState('')
  const [totalSol, setTotalSol] = useState('0.5')
  const [initialBuySol, setInitialBuySol] = useState('0.05')
  const [status, setStatus] = useState('idle')
  const [result, setResult] = useState<PumpLaunchResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!aleo) return <p>Connect an Aleo wallet.</p>
  if (!solana) return <p>Connect a Solana wallet (use a fresh account for maximum unlinkability).</p>

  async function launch() {
    setStatus('starting'); setError(null); setResult(null)
    try {
      const r = await pumpLaunch({
        bridge: getBridgeClient(),
        aleoWallet: aleo.walletClient,
        creator: {
          publicKey: solana.publicKey.toBase58(),
          signTransaction: solana.signTransaction as never,
        },
        totalSol,
        initialBuySol,
        metadata: { name, symbol, imageUri },
        pinMetadata: pinMetadataToIpfs,
        launchWithCreator,
        onStage: (s) => setStatus(s.status),
      })
      setResult(r)
      setStatus('launched')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('failed')
    }
  }

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12, maxWidth: 480 }}>
      <h2>Anonymous pump.fun launch</h2>
      <p>
        Tip: in your Solana wallet, add a fresh account just for this launch.
        Its on-chain history will start at the bridge deposit, with no link
        back to your Aleo identity.
      </p>

      <label>Name: <input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Symbol: <input value={symbol} onChange={(e) => setSymbol(e.target.value)} /></label>
      <label>Image URI: <input value={imageUri} onChange={(e) => setImageUri(e.target.value)} placeholder="https://..." /></label>
      <label>Total SOL (for launch + initial buy + fees): <input value={totalSol} onChange={(e) => setTotalSol(e.target.value)} /></label>
      <label>Initial buy SOL: <input value={initialBuySol} onChange={(e) => setInitialBuySol(e.target.value)} /></label>

      <button onClick={launch} disabled={!name || !symbol || !imageUri}>Launch</button>

      <div>Status: <strong>{status}</strong></div>
      {result && (
        <div>
          <p>Token mint: <code>{result.tokenMint}</code></p>
          <p><a href={result.pumpfunUrl} target="_blank" rel="noreferrer">View on pump.fun</a></p>
        </div>
      )}
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @veil/private-fun typecheck`
Expected: PASS. The `as never`/`as unknown as never` casts in `launch-with-creator.ts` exist to paper over pump-sdk's actual API surface — when you wire to the real SDK at implementation time, replace them with the real types.

- [ ] **Step 5: Commit**

```bash
git add apps/private-fun/src/lib/pin-metadata.ts apps/private-fun/src/lib/launch-with-creator.ts apps/private-fun/src/pages/PumpLaunch.tsx
git commit -m "add PumpLaunch page + pinata + pump-sdk wiring"
```

---

## Task 12: App.tsx with routing

**Files:**
- Modify: `apps/private-fun/src/App.tsx`

- [ ] **Step 1: Replace `apps/private-fun/src/App.tsx`**

```typescript
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { WalletConnect } from './components/WalletConnect.js'
import { FundOut } from './pages/FundOut.js'
import { BridgeIn } from './pages/BridgeIn.js'
import { PumpLaunch } from './pages/PumpLaunch.js'

export function App() {
  return (
    <BrowserRouter>
      <header style={{ padding: 12, borderBottom: '1px solid #ddd' }}>
        <h1>private.fun</h1>
        <nav style={{ display: 'flex', gap: 12 }}>
          <Link to="/fund-out">Fund out</Link>
          <Link to="/bridge-in">Bridge in</Link>
          <Link to="/pump-launch">Pump launch</Link>
        </nav>
        <WalletConnect />
      </header>
      <main>
        <Routes>
          <Route path="/" element={<FundOut />} />
          <Route path="/fund-out" element={<FundOut />} />
          <Route path="/bridge-in" element={<BridgeIn />} />
          <Route path="/pump-launch" element={<PumpLaunch />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}
```

- [ ] **Step 2: Typecheck + build**

Run: `pnpm --filter @veil/private-fun typecheck`
Expected: PASS.

Run: `pnpm --filter @veil/private-fun build`
Expected: PASS. May surface real type issues in `launch-with-creator.ts` if pump-sdk's API differs from the illustrative casts — fix inline by reading the actual `@pump-fun/pump-sdk` types from `node_modules/@pump-fun/pump-sdk/dist/index.d.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/private-fun/src/App.tsx
git commit -m "wire App.tsx routing across three pages"
```

---

## Task 13: Workspace green + dev server smoke + README

**Files:**
- Create: `apps/private-fun/README.md`

- [ ] **Step 1: README**

```markdown
# @veil/private-fun

Demo dapp for cross-chain funding to and from Aleo, with three multi-wallet ecosystems composed side-by-side.

## What it does

- **Fund out** — bridge ALEO / wrapped assets / USDCX / USAD from Aleo to Solana/Ethereum/Base/Arbitrum.
- **Bridge in** — bridge SOL / ETH / USDC / USDT / WBTC from any of those chains into a shielded Aleo record.
- **Pump launch** — anonymous pump.fun token launch funded by a bridged ALEO → SOL transfer.

## Required env

Create `.env.local`:

\`\`\`
VITE_WSA_BASE_URL=https://wallet-services.provable.com/api
VITE_PINATA_JWT=<jwt for pinata pin>
VITE_SOLANA_RPC=https://api.mainnet-beta.solana.com
VITE_WALLET_CONNECT_PROJECT_ID=<from cloud.walletconnect.com>
\`\`\`

`VITE_PINATA_JWT` is only required to launch tokens (otherwise IPFS pinning fails).
`VITE_WALLET_CONNECT_PROJECT_ID` is optional — without it, WalletConnect is disabled but injected wallets still work.

## Develop

\`\`\`
pnpm install
pnpm --filter @veil/private-fun dev
\`\`\`

## Test

\`\`\`
pnpm vitest run apps/private-fun/test/
\`\`\`

## Networks

All flows operate on mainnet (Aleo mainnet, Solana mainnet-beta, Ethereum/Base/Arbitrum mainnet). The bridge does not route to testnets.
```

- [ ] **Step 2: Workspace-wide typecheck**

Run: `pnpm typecheck`
Expected: PASS for all `@veil/*` packages. Pre-existing `apps/loyalty-dapp` and `apps/loyalty-node` failures are unrelated to this work.

- [ ] **Step 3: Workspace-wide test**

Run: `pnpm vitest run`
Expected: PASS — all bridge/core/private-fun tests.

- [ ] **Step 4: Dev server smoke**

Run: `pnpm --filter @veil/private-fun dev` (background process)
- Open http://localhost:5173/
- Confirm: page loads, "private.fun" header visible, nav links work.
- Click WalletConnect — Aleo, Solana, Ethereum connect entry points all render.
- Don't expect end-to-end mainnet bridging to work in a smoke test — you'd need real funds.

Kill the dev server.

- [ ] **Step 5: Commit**

```bash
git add apps/private-fun/README.md
git commit -m "add private-fun README and verify workspace green"
```

---

## Out of scope (follow-ups)

- **Polished UI / design system.** v1 is intentionally minimal CSS. Polish is a separate effort.
- **Source-chain deposit auto-signing in BridgeIn.** v1 surfaces the deposit instructions and asks the user to sign in their wallet; v2 wires `wallet.signTransaction` / `walletClient.sendTransaction` directly through the page.
- **Portfolio aggregate balance page.** Per-page wallet status banner suffices for v1.
- **Quote pre-flight UI** — show all available quotes before order creation so the user can pick. v1 uses `selectQuote: 'best'` silently. The recipe already supports the callback shape; the UI just needs a modal.
- **MCP tool wrappers for recipes.** Recipes are structured-JSON in/out already; a thin MCP server is straightforward when needed.
- **End-to-end mainnet test.** Requires real funded accounts; document the manual smoke procedure in the README.

---

## Self-Review Notes

- All recipe types compose: `fundOut` returns `SwapReturnType` from `@veil/bridge`; `bridgeIn` returns a structured record with `quote`, `instructions`, and `waitForCompletion`; `pumpLaunch` composes `fundOut` + injected `launchWithCreator`.
- Recipe tests inject `BridgeClient` and signer mocks — no network access, no wallet adapters needed.
- Page components are thin: form state → recipe call → display result/error.
- Three-wallet stack is pure composition of standard adapters (`@veil/react` → `@solana/wallet-adapter-react` → `WagmiProvider`).
- `record` field is *not* present in any recipe parameter — the bridge package now auto-resolves records through the underlying `@veil/core` transfer action.
