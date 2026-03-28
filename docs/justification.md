# aleo-viem: A Unified Developer Interface for Aleo

## The Problem

Aleo's developer ecosystem is fragmented. Every surface — the WASM SDK, Shield Mobile SDK, Leo Wallet, Puzzle Wallet, Fox Wallet — has its own bespoke API, its own patterns, and its own mental model. A developer who learns one doesn't know the other. There is no shared language across the ecosystem.

This isn't just inconvenient. It's a structural barrier to adoption.

### Developers aren't coming from zero — they're coming from Ethereum

The vast majority of dApp developers today work on EVM chains or Solana. They think in terms of `getBalance`, `sendTransaction`, `readContract`. They've built with viem, ethers.js, or web3.js. When they evaluate Aleo, they encounter:

- Programs instead of contracts
- Records instead of balances
- Transitions instead of transactions
- Proving instead of signing
- View keys, compute keys, and a three-tier key hierarchy

Every one of these concepts has an analogue they already understand — but the existing tooling presents them as entirely foreign. The result: developers who would build on Aleo bounce off the onboarding curve before they ship anything.

### The cost of fragmentation is compounding

Today, each new wallet or SDK that enters the Aleo ecosystem must invent its own integration path. There is no standard developer-facing interface for them to implement. This means:

- **Wallet developers** build adapters that only work with their wallet
- **dApp developers** write integration code per wallet, per SDK, per platform
- **New entrants** have no clear path to plug into the ecosystem — they must study each existing tool individually

Every new participant multiplies the integration surface instead of reducing it.

## The Solution

**aleo-viem** is a TypeScript interface library that wraps Aleo's existing wallets and SDKs behind a unified, viem-compatible API.

It does not replace any existing tool. It sits above them, providing a single interface that any wallet, SDK, or service can implement. Developers write their dApp once, against the aleo-viem interface, and it works with every wallet and SDK that plugs in.

```ts
// This is all a developer needs to read a balance on Aleo
const client = createPublicClient({
  transport: http('https://api.provable.com/v2'),
})
const balance = await client.getBalance({ address: 'aleo1...' })
```

A developer who has used viem on Ethereum can read this immediately. The learning curve is the delta between Ethereum and Aleo's unique concepts — not the delta between zero and an entirely unfamiliar SDK.

## Why This Matters for AI-Driven Development

### Agents already know viem

The most capable coding agents — Claude, GPT-4, Codex — have been trained extensively on Ethereum development tooling. They know how to use viem. They know `createPublicClient`, `createWalletClient`, `readContract`, `writeContract`. This isn't a minor advantage. It means:

- **An agent asked to "build an Aleo dApp" can start immediately** using patterns it already knows, rather than requiring extensive context about bespoke Aleo APIs
- **The prompt engineering burden on developers drops dramatically** — instead of explaining Aleo's SDK conventions in every prompt, they write natural instructions like "read the balance" or "execute a transfer"
- **Agent-built code is more reliable** because the agent is working with a well-known interface rather than improvising against unfamiliar documentation

### Without it, every agent interaction starts from scratch

Today, asking an AI agent to build on Aleo requires:

1. Providing extensive documentation about whichever SDK you're using
2. Explaining Aleo-specific concepts and how they map to what the agent knows
3. Correcting the agent repeatedly as it tries to apply Ethereum patterns to Aleo's bespoke APIs
4. Repeating this for every new wallet or SDK surface

This friction compounds. It makes Aleo harder to build on with AI assistance than chains with standardized tooling. In a world where AI-driven development is becoming the primary way software gets built, **being hard for agents to work with is being hard to build on, period.**

### MCP servers and agent tooling

aleo-viem provides the foundation for building MCP (Model Context Protocol) servers that give AI agents direct access to Aleo. An MCP server backed by aleo-viem exposes Aleo capabilities through the same interface patterns agents already understand. Without a unified interface, every MCP server would need to be built against a specific SDK, fragmenting the agent ecosystem the same way the developer ecosystem is fragmented today.

Similarly, agents operating through Shield Wallet or directly via the SDK benefit from a single interface — the agent code doesn't change when the backing wallet or SDK changes.

## What We Lose Without It

### Developer adoption slows

Every Ethereum developer who evaluates Aleo must learn not just Aleo's concepts, but multiple bespoke tool APIs. The ones who stay are the ones willing to accept that cost. The rest build on chains where they can reuse what they know.

### Wallet ecosystem stays siloed

Without a shared interface for wallets to implement, each new wallet is an island. dApp developers must integrate each one individually. The practical result: dApps support 1-2 wallets at launch and rarely add more. This limits wallet competition and user choice.

### AI ecosystem disadvantage

Chains with viem, ethers.js, and similar standardized tooling are easier for agents to build on. As AI-assisted development becomes dominant, Aleo's lack of a standardized interface becomes a competitive disadvantage that grows over time. Developers will default to chains where their agents are most effective.

### Integration burden falls on every team separately

Without aleo-viem, every team building on Aleo — internal or external — solves the same integration problems independently. This is duplicated effort across the ecosystem that a shared library eliminates once.

## Scope and Cost

aleo-viem core is a TypeScript library with zero hard dependencies on any specific SDK. It defines interfaces and ships reference implementations for:

- Public read operations (blocks, transactions, balances, program state)
- Wallet operations (execute, deploy, sign, transfer)
- Transport layer (HTTP to Aleo nodes, wallet adapter wrapping)
- Account abstraction (local signing, RPC-delegated signing, view-only)
- Pluggable proving and record scanning

It wraps the existing wallet adapter, @provablehq/sdk, and Shield Mobile SDK. It does not replace any of these — it provides a unified surface above them.

The core library is a focused, bounded project. Future packages (`@aleo-viem/react`, `@aleo-viem/mobile`) extend it for specific platforms but are not required for v1.

## The Ask

Fund the development of `@aleo-viem/core` as the standard developer interface for Aleo. Position it as the recommended way to build dApps on Aleo, the foundation for AI agent tooling, and the integration target for new wallets entering the ecosystem.

The alternative is continuing to ask every developer, every agent, and every new wallet to solve the same fragmentation problems independently — a cost that grows with every participant we add to the ecosystem.
