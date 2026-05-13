# Leo AMM — Concentrated Liquidity DEX on Aleo

A next-generation decentralized exchange built on the Aleo blockchain, bringing capital-efficient trading with concentrated liquidity — the same model that powers the most successful DEXs in DeFi, now with Aleo's privacy guarantees.

---

## What Is Leo AMM?

Leo AMM is a **decentralized exchange (DEX)** that allows users to swap tokens and provide liquidity — all on-chain, without intermediaries. Unlike traditional AMMs where liquidity is spread across an infinite price range, Leo AMM uses **concentrated liquidity**, meaning liquidity providers (LPs) can focus their capital within specific price ranges. This results in dramatically better capital efficiency, deeper liquidity around the current price, and better prices for traders.

---

## How It Works

### The Basics

At its core, the DEX operates through **liquidity pools** — smart contracts that hold reserves of two tokens (e.g., Token A and Token B). Traders swap one token for another against these pools, and liquidity providers earn fees for making those swaps possible.

### Concentrated Liquidity — The Key Innovation

In a traditional AMM, if you deposit $10,000 of liquidity, it gets spread across every possible price from $0 to infinity. Most of that capital sits idle because trades only happen near the current price.

With concentrated liquidity, LPs choose a **specific price range** to deploy their capital. For example:

- A stablecoin pair LP might concentrate liquidity between $0.99 and $1.01
- A volatile pair LP might choose a wider range like $1,500–$2,500

This means:
- **LPs earn more fees** — their capital is active where trades actually happen
- **Traders get better prices** — deeper liquidity around the market price means less slippage
- **Less capital required** — achieve the same depth of liquidity with a fraction of the capital

---

## Key Roles

### Traders
Traders swap one token for another. They interact with pools, paying a small fee on each trade. The DEX supports both **single-pool swaps** and **multi-hop swaps** (routing through up to 3 pools) to find the best path between any two tokens.

### Liquidity Providers (LPs)
LPs deposit token pairs into pools within a chosen price range. In return, they receive a **Position NFT** — a private, non-fungible token on Aleo that represents their liquidity position. As trades occur within their selected range, they earn a proportional share of the trading fees.

### Protocol Admin
The admin manages protocol-level settings such as:
- Enabling or disabling fee tiers
- Adjusting the protocol's share of trading fees
- Enabling or disabling pools
- Transferring admin rights

---

## Trading on Leo AMM

### Single Swaps
A trader selects a pool, provides an input token, and receives the output token. Each swap includes:

- **Slippage protection** — set a minimum output amount so you're never surprised
- **Price limit** — cap how far the price can move during your trade
- **Deadline** — the swap must execute before a specified block height, preventing stale transactions

### Multi-Hop Swaps
When there's no direct pool between two tokens, the DEX automatically routes through intermediate pools. For example, swapping Token A to Token C might route through:

**Token A → Token B → Token C** (2 hops)

Or even:

**Token A → Token B → Token C → Token D** (3 hops)

Each hop is executed atomically — either the entire route succeeds, or nothing happens. Every hop has its own price limit protection, guarding against unfavorable price movement at each step.

---

## Providing Liquidity

### Opening a Position
1. **Choose a pool** — select the token pair and fee tier
2. **Set your range** — pick the lower and upper price bounds where your liquidity will be active
3. **Deposit tokens** — provide the required amounts of both tokens
4. **Receive your Position NFT** — a private record on Aleo proving your ownership

### Managing a Position
- **Increase liquidity** — add more capital to your existing range at any time
- **Decrease liquidity** — withdraw part or all of your liquidity
- **Collect fees** — claim your accumulated trading fees whenever you want
- **Burn** — close your position entirely after withdrawing all liquidity and fees

### How LPs Earn
Every time a trade occurs within a pool, the trader pays a fee. That fee is split:

1. **LP share** — distributed proportionally to all LPs whose price range covers the current price
2. **Protocol share** — a configurable fraction that goes to the protocol treasury

Fees accumulate automatically. LPs can collect their earned fees at any time without removing their liquidity.

---

## Fee Structure

The DEX supports **multiple fee tiers** to suit different token pairs:

| Fee Tier | Rate | Best For |
|----------|------|----------|
| Ultra-low | 0.01% | Stablecoin pairs (USDC/USDT) |
| Low | 0.05% | Closely correlated assets |
| Medium | 0.30% | Standard pairs |
| High | 1.00% | Exotic or volatile pairs |

LPs choose which fee tier to provide liquidity in. Higher fees compensate for greater impermanent loss risk on volatile pairs, while low fees attract higher volume on stable pairs.

### Protocol Fee
The protocol can take a portion of LP fees (configurable between 25%–62.5% of the trading fee, or disabled entirely). This revenue supports ongoing development, operations, and the broader ecosystem. The protocol admin can adjust this per pool.

---

## Privacy on Aleo

Leo AMM is built on Aleo, leveraging its **zero-knowledge proof system** to create a unique balance: **transparent markets with private participants**. Every major action — swapping, providing liquidity, and collecting fees — has both a **public** and a **private** path. Users choose the level of privacy they need.

### How Address Masking Works

The core privacy mechanism is **cryptographic address blinding**. When a user chooses the private path, the protocol replaces their real wallet address with a **blinded address** — a one-time cryptographic commitment that is mathematically unlinkable to the real wallet.

Here's how it works in plain terms:

1. The user provides a secret random value (a "blinding factor") alongside their transaction
2. The protocol combines the user's real address with this blinding factor to produce a **blinded address** — a completely new address that appears on-chain
3. This blinded address is what gets stored in all public records (swap outputs, position data, etc.)
4. Only the user, who knows both their real address and the blinding factor, can later prove they own that blinded address and claim their funds

An outside observer sees the blinded address on-chain but has **no way** to reverse-engineer the real wallet behind it. Each transaction uses a unique blinding factor, so even multiple transactions from the same wallet produce different blinded addresses — making them unlinkable to each other and to the real owner.

### Public vs. Private: Two Paths for Every Action

Users can choose between a standard (public) path and a private path depending on their needs:

**Trading:**
- `swap` / `swap_multi_hop` — standard path where caller and recipient addresses are visible on-chain
- `swap_private` / `swap_multi_hop_private` — private path where both caller and recipient are replaced with blinded addresses; output tokens are received as private records that only the owner can see

**Providing Liquidity:**
- `mint` — standard path where the LP's recipient address is visible
- `mint_private` — private path where the LP's identity is blinded; the Position NFT is linked to a blinded address, making it impossible to determine which wallet owns the position

**Collecting Fees:**
- `collect` — standard path where withdrawn fees are sent publicly to the recipient
- `collect_private` — private path where fees are delivered as private token records, hiding the recipient entirely

**Claiming Swap Outputs:**
- `claim_swap_output` / `claim_multi_hop_output` — standard claim with public token transfer
- `claim_swap_output_private` / `claim_multi_hop_output_private` — private claim where output tokens are converted into private records, shielding the final recipient

### What Is Visible On-Chain

Pool-level data is fully transparent — this is by design. Fair and verifiable trading requires that everyone can see:

- **Pool state** — current price, total active liquidity, and fee configuration
- **Tick data** — how much liquidity sits at each price level
- **Swap amounts** — the size of each trade, the tokens involved, and the output amounts
- **Liquidity position details** — the price range, liquidity amount, and accumulated fees for each position (identified by an opaque token ID, not by wallet address)

This transparency ensures accurate price discovery, allows anyone to verify the protocol is working correctly, and maintains the trust properties that DeFi users expect.

### What Is Private

When using the private path, the following are hidden from on-chain observers:

- **Trader identity** — the caller and recipient in swap outputs are blinded addresses, not real wallets. No one can determine who executed a trade or who received the output tokens.

- **LP identity** — Position NFTs are private records that exist only in the owner's wallet. The on-chain position data is keyed by an opaque token ID derived from the blinded address. An observer can see "Position #X has 50,000 units of liquidity between price $1,800 and $2,200" — but they **cannot** determine which address owns it.

- **Position management** — when an LP increases, decreases, or collects fees, they submit their private Position NFT as input. The NFT is consumed and a new one is returned. Because records on Aleo are encrypted on-chain, outside observers cannot link successive position updates to a specific wallet.

- **Token balances after claiming** — when using private claims, output tokens are delivered as encrypted private records rather than public balance updates. The recipient's balance change is invisible to everyone except the owner.

### The Privacy Model in Practice

| Action | What's Public | What's Private (blinded path) |
|--------|--------------|-------------------------------|
| **Creating a pool** | Token pair, fee tier, initial price | — |
| **Providing liquidity** | Position's price range, liquidity amount, token ID | Owner's wallet address (blinded), NFT ownership |
| **Swapping tokens** | Swap amount, tokens, price impact | Caller & recipient address (blinded), output token records |
| **Collecting fees** | Fee amounts withdrawn (by token ID) | Recipient wallet (blinded), token records |
| **Multi-hop swaps** | Route, amounts at each hop | Caller & recipient address (blinded), output token records |
| **Claiming outputs** | Amount claimed (by swap ID) | Recipient wallet (blinded), token records |

### Why This Matters

In traditional DeFi, every action is tied to a visible wallet address. This creates risks:

- **Front-running** — bots can see a large LP deposit or trade coming and act ahead of it
- **Targeted attacks** — knowing which wallets hold large positions makes them targets for social engineering or exploitation
- **Portfolio exposure** — anyone can reconstruct your full DeFi activity from your on-chain history
- **Trade surveillance** — competitors, market makers, or adversaries can track your trading patterns in real time

Leo AMM's dual-path privacy model eliminates these risks when the private path is used. Market data stays transparent for price efficiency and protocol integrity, while participant identities are cryptographically shielded. You get the best of both worlds: **a fair, verifiable market where your financial activity isn't tied to your public identity**.

---

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│                  Traders                     │
│         (Swap / Multi-Hop Swap)              │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│              Leo AMM Protocol                │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  Pool A   │  │  Pool B   │  │  Pool C   │ │
│  │ (0.05%)   │  │ (0.30%)   │  │ (1.00%)   │ │
│  └──────────┘  └──────────┘  └──────────┘  │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │       Concentrated Liquidity          │   │
│  │    Tick-Based Price Range System      │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │     Fee Engine & Protocol Treasury    │   │
│  └──────────────────────────────────────┘   │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│           Token Registry (Aleo)              │
│        (Token Transfers & Balances)          │
└─────────────────────────────────────────────┘
                   ▲
                   │
┌──────────────────┴──────────────────────────┐
│            Liquidity Providers               │
│    (Mint / Increase / Decrease / Collect)     │
│         Position NFTs (Private)              │
└─────────────────────────────────────────────┘
```

---

## Summary

| Feature | Description |
|---------|-------------|
| **Concentrated Liquidity** | LPs deploy capital in custom price ranges for maximum efficiency |
| **Multi-Hop Routing** | Swap any token pair through up to 3 intermediate pools |
| **Multiple Fee Tiers** | From 0.01% to 1.00% — optimized for every asset type |
| **Position NFTs** | Private, on-chain proof of your liquidity position |
| **Protocol Fees** | Configurable revenue share for sustainable development |
| **Slippage & Price Protection** | Built-in safeguards on every trade |
| **Blinded Address Privacy** | Cryptographic address masking hides trader and LP identities on-chain |
| **Public & Private Paths** | Every action has a standard and a private variant — users choose their privacy level |
| **Admin Governance** | Flexible protocol management with transferable admin rights |

---

*Built with Leo on Aleo.*
