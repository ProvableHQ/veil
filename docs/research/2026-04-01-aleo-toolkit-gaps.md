# Aleo Developer Toolkit Gap Analysis

**Date:** 2026-04-01
**Author:** Research synthesis for veil planning
**Status:** Draft

## Summary Table

| Gap Area | Priority | Ethereum Equivalent | Solana Equivalent | Aleo Status |
|---|---|---|---|---|
| Unified TypeScript SDK | P0 | viem / ethers.js | @solana/web3.js | veil (in dev) |
| Wallet Connect Kit (React) | P0 | RainbowKit / ConnectKit | Solana Wallet Adapter UI | None (adapter exists, no UI) |
| Contract/Program Testing Framework | P0 | Hardhat / Foundry | Anchor test | Leo test (basic), Leology (early) |
| Indexer / Subgraph Service | P0 | The Graph / Ponder | Helius / GenesysGo | Aleoscan API (limited) |
| Local Dev Network CLI | P1 | Hardhat Network / Anvil | solana-test-validator | `snarkos start --dev` (bare) |
| Program Interaction Codegen | P1 | TypeChain / wagmi CLI | Anchor IDL codegen | None |
| Deployment & Verification Pipeline | P1 | Hardhat Deploy / Tenderly | Anchor deploy | `leo deploy` (manual) |
| React Hooks Library | P1 | wagmi | @solana/wallet-adapter-react | None |
| Event/Transition Listener | P1 | ethers events / viem watchEvent | Solana WebSocket subscriptions | None |
| MCP Server for Aleo | P0 | N/A (EVM MCP servers exist) | N/A | None |
| Agent Tool Schemas | P0 | Coinbase AgentKit (EVM) | Coinbase AgentKit (Solana) | None |
| Multi-chain Bridge SDK | P2 | Across / LayerZero SDK | Wormhole SDK | None |
| Security Analysis Tooling | P2 | Slither / Mythril / Certora | Soteria / sec3 | None |
| Documentation Generator | P2 | NatSpec + solidity-docgen | Anchor docs | None |
| Program Registry / Package Manager | P2 | OpenZeppelin / npm | crates.io + Anchor | None |

---

## Part 1: Developer Toolkit Gaps

### 1.1 Wallet Connection UI Kit (P0 -- Q2)

**The gap:** The `aleo-wallet-adaptor` provides a standard interface for connecting wallets, but there is no pre-built UI component library. Every dApp must build its own connect modal, account display, and network switcher from scratch.

**What Ethereum has:** RainbowKit and ConnectKit provide drop-in React components with polished UX: wallet selection modals, ENS resolution, chain switching, and theming -- all built on wagmi hooks. A developer goes from zero to working wallet connection in under 10 lines of code.

**What Solana has:** `@solana/wallet-adapter-react-ui` provides similar out-of-the-box components for Phantom, Solflare, and others.

**Recommendation:** Build `@aleo-dev-toolkit/connect-kit` -- a React component library wrapping `aleo-wallet-adaptor` with:
- Pre-built `<ConnectButton />` and `<WalletModal />` components
- Theming system (light/dark, custom brand colors)
- Support for Leo Wallet, Puzzle Wallet, Fox Wallet, Shield Mobile
- Network switching (mainnet/testnet/devnet)
- Account display with address truncation and copy
- Mobile-responsive design

This should be built on top of a hooks layer (`@aleo-dev-toolkit/react` or `@veil/react`) that provides `useWallet()`, `useBalance()`, `useRecords()`, etc.

---

### 1.2 Program Testing Framework (P0 -- Q2)

**The gap:** Leo has basic `@test` annotations and a `tests/` directory convention, plus the third-party Leology framework is in early stages. But there is no equivalent to the comprehensive test harness that Hardhat or Foundry provides: no forking, no gas snapshots, no fuzz testing, no coverage reporting, no test fixtures for common patterns.

**What Ethereum has:**
- **Hardhat:** JS/TS test runner with Mocha/Chai, local EVM, forking from mainnet, console.log in Solidity, gas reporting, coverage via solidity-coverage
- **Foundry:** Rust-native test runner with fuzz testing, differential testing, gas snapshots, fork testing, cheatcodes (`vm.prank`, `vm.warp`, etc.)

**What Solana has:**
- **Anchor test:** Mocha-based JS tests with automatic program deployment, bankrun for fast local testing, comprehensive fixtures

**Recommendation:** Invest in a `@aleo-dev-toolkit/test` package or enhance Leology with:
- TypeScript test runner that deploys programs to a local devnet and executes transactions
- Test fixtures for common patterns (token transfers, record creation/consumption)
- Snapshot testing for mapping state
- Fuzz testing for Leo program inputs (especially important for ZK circuits where edge cases cause proving failures)
- Coverage reporting at the Leo source level
- Integration with veil so tests can use the same API surface as production code

---

### 1.3 Indexer / Data Query Service (P0 -- Q2)

**The gap:** Aleo has block explorers (Aleoscan, Provable Explorer) with REST APIs, but there is no general-purpose indexing service that lets dApp developers define custom data schemas and query historical program state. Mapping values are queryable but only for current state. There is no way to subscribe to transition events, query historical mapping changes, or build aggregate views.

**What Ethereum has:**
- **The Graph:** Decentralized indexing protocol with custom subgraphs, GraphQL queries, real-time subscriptions
- **Ponder:** TypeScript-native indexer with hot reloading and familiar ORM patterns
- **Tenderly:** Transaction simulation, debugging, alerting, and monitoring

**What Solana has:**
- **Helius:** RPC + webhooks + DAS API for compressed NFTs and token metadata
- **GenesysGo:** Shadow Drive + indexing infrastructure
- **Shyft:** GraphQL API for Solana program data

**Recommendation:** The toolkit needs:
1. **Transition event listener** (P1): A library that polls or subscribes to new blocks and emits typed events when specific program transitions occur. This could live in veil as `watchTransition()`.
2. **Lightweight indexer SDK** (P1): A TypeScript framework for defining indexing handlers that process Aleo transitions and store results in a local database (SQLite/Postgres). Think Ponder for Aleo.
3. **Hosted indexing service** (P2): A managed service (like The Graph) where developers deploy indexing configurations and get a GraphQL endpoint. This is a larger infrastructure investment.

---

### 1.4 Local Development Network Tooling (P1 -- Q3)

**The gap:** Running `snarkos start --dev` gives you a local devnet, but it lacks developer conveniences: no pre-funded accounts, no time manipulation, no state snapshotting/reverting, no automatic program deployment on startup, no integrated block explorer.

**What Ethereum has:**
- **Anvil (Foundry):** Instant local chain, auto-mining, time manipulation (`evm_increaseTime`), state snapshots/reverts, impersonation, mainnet forking, pre-funded accounts
- **Hardhat Network:** Same capabilities plus console.log, stack traces, Solidity error messages

**Recommendation:** Build `@aleo-dev-toolkit/devnet` or contribute upstream to snarkOS:
- Pre-configured accounts with known private keys and funded balances
- Fast block mode (instant finality for testing)
- State snapshot and revert (critical for test isolation)
- Configuration file for auto-deploying programs on startup
- Integrated lightweight explorer UI (localhost web dashboard)

---

### 1.5 Program Interaction Codegen (P1 -- Q3)

**The gap:** When a developer wants to call an Aleo program from TypeScript, they must manually construct input strings, know the exact function signatures, and parse output records by hand. There is no tool that reads a Leo program's ABI/interface and generates typed TypeScript bindings.

**What Ethereum has:**
- **TypeChain:** Generates TypeScript types from Solidity ABIs
- **wagmi CLI:** Generates React hooks from contract ABIs
- **viem:** `getContract()` returns a typed object from ABI

**What Solana has:**
- **Anchor IDL:** Generates TypeScript client from program IDL, with full type safety

**Recommendation:** The veil `getContract()` function (already in the design spec) partially addresses this by parsing program source to generate typed methods. Additionally:
- Build a standalone CLI tool that generates TypeScript types from `.leo` source files or deployed program interfaces
- Output should include function parameter types, record types, and mapping key/value types
- Integration with veil's `getContract()` for runtime type checking

---

### 1.6 React Hooks Library (P1 -- Q3)

**The gap:** No React hooks exist for common Aleo operations. Every dApp must build custom state management for wallet connection, balance queries, record management, and transaction submission.

**What Ethereum has:** wagmi provides `useBalance()`, `useContractRead()`, `useContractWrite()`, `useSendTransaction()`, `useWaitForTransaction()`, etc. -- all with caching, automatic refetching, and error handling via TanStack Query.

**Recommendation:** Build `@veil/react` (already a stated non-goal for core, but planned as a separate package):
- `usePublicClient()`, `useWalletClient()`
- `useBalance()`, `useRecords()`
- `useReadContract()`, `useWriteContract()`
- `useWaitForTransaction()`
- `useBlockNumber()`, `useBlock()`
- Built on TanStack Query for caching and automatic refetching
- SSR-compatible

---

### 1.7 Deployment Pipeline & Program Verification (P1 -- Q3)

**The gap:** Deploying an Aleo program involves manually running `leo deploy` with correct parameters. There is no deployment scripting framework, no deployment artifact management, no multi-environment configuration, and no source verification system.

**What Ethereum has:**
- **Hardhat Deploy:** Deterministic deployments, deployment scripts, upgrade management
- **Foundry scripts:** Solidity-based deployment scripts
- **Etherscan verification:** Source code verification against deployed bytecode
- **Tenderly:** Transaction simulation before deployment, monitoring after

**Recommendation:**
- `@aleo-dev-toolkit/deploy`: Deployment scripting framework with environment configs (devnet/testnet/mainnet), artifact tracking, and idempotent deploys
- Program verification service: Given the Leo source, verify it compiles to the deployed program bytecode on-chain. This builds trust in deployed programs.

---

### 1.8 Security Analysis Tooling (P2 -- later)

**The gap:** No static analysis tools exist for Leo programs. No formal verification. No audit tooling. Given that Aleo programs handle private state and ZK proofs, security tooling is arguably even more important than for Solidity.

**What Ethereum has:** Slither, Mythril, Echidna, Certora, Trail of Bits tooling
**What Solana has:** Soteria, sec3 (formerly Neodyme)

**Recommendation:** This is a larger investment, likely requiring collaboration with the Leo compiler team. Start with:
- Linter for common Leo anti-patterns
- Static analysis for record handling bugs (double-spend patterns, unconsumed records)
- Gas/fee estimation for program executions

---

### 1.9 Program Registry / Reusable Components (P2 -- later)

**The gap:** No equivalent of OpenZeppelin for Aleo. Developers cannot import audited, battle-tested token implementations, access control patterns, or utility libraries.

**What Ethereum has:** OpenZeppelin Contracts -- the de facto standard library for Solidity
**What Solana has:** Metaplex (NFTs), SPL Token library

**Recommendation:** Curate a set of reference Leo programs:
- ARC-20 token implementation (standard fungible token)
- ARC-721 NFT implementation
- Multi-sig program
- Access control patterns
- Publish as a registry or importable Leo library

---

## Part 2: Agent Tooling Gaps

### 2.1 Aleo MCP Server (P0 -- Q2)

**The gap:** MCP has reached 97 million monthly SDK downloads as of March 2026. BitGo, Coinbase, and Debridge all have MCP servers. Aleo has none. AI agents using Claude, GPT, or other LLMs cannot interact with the Aleo blockchain through their native tool-use interfaces.

**Current landscape:**
- BitGo launched an MCP server (March 2026) for institutional custody operations
- Coinbase Payments MCP connects agents to wallets, onramps, and stablecoin transactions
- Debridge MCP enables cross-chain swaps and bridging
- No Aleo-specific MCP server exists

**Recommendation:** Build `@aleo-dev-toolkit/mcp-server` shipping the following tool categories:

| Tool Category | Example Tools | Priority |
|---|---|---|
| Read Chain State | `getBalance`, `getBlock`, `getTransaction`, `readMapping` | P0 |
| Account Management | `createAccount`, `getAddress`, `getViewKey` | P0 |
| Transfer & Execute | `transfer`, `executeProgram`, `deployProgram` | P0 |
| Record Management | `getRecords`, `decryptRecord`, `getRecordPlaintext` | P1 |
| Program Inspection | `getProgramSource`, `getProgramMappings`, `getProgramFunctions` | P1 |
| Network Info | `getLatestBlock`, `getNetworkStatus`, `estimateFee` | P1 |

Each tool must return **structured JSON** (not human-readable strings) with consistent error schemas. This is the single most important difference between agent-friendly and human-friendly APIs.

**Architecture:** The MCP server should wrap veil, so tool implementations are thin adapters over the unified SDK. As veil grows, MCP tools grow automatically.

---

### 2.2 Agent Tool Schemas for Framework Integration (P0 -- Q2)

**The gap:** Beyond MCP, AI agents use various framework-specific tool formats: OpenAI function calling JSON Schema, LangChain tool definitions, Vercel AI SDK tool schemas, Coinbase AgentKit action definitions. Aleo has no presence in any of these ecosystems.

**What exists for EVM:**
- Coinbase AgentKit: EVM wallet operations, token transfers, swaps, smart contract interactions -- works with OpenAI, Claude, Llama
- LangChain has web3 tool integrations for Ethereum
- Vercel AI SDK has crypto tool examples

**Recommendation:** Build `@aleo-dev-toolkit/agent-tools` as a framework-agnostic tool definition package:

```
@aleo-dev-toolkit/agent-tools
  /mcp          -- MCP tool definitions
  /openai       -- OpenAI function calling schemas
  /langchain    -- LangChain tool wrappers
  /vercel-ai    -- Vercel AI SDK tools
  /agentkit     -- Coinbase AgentKit integration
  /schemas      -- Shared JSON schemas for all formats
```

The key insight: tool *definitions* (name, description, parameters, output schema) should be authored once and compiled to each format. This avoids drift between framework integrations.

---

### 2.3 Agent-Friendly vs Human-Friendly API Design (P0 -- built into veil)

**The gap:** Most blockchain APIs are designed for human developers reading docs and writing code. Agents need different things.

| Concern | Human Developer | AI Agent |
|---|---|---|
| Error messages | Readable stack trace | Structured JSON with error code, field, suggestion |
| Output format | Console-friendly | Parseable JSON with consistent schema |
| Discovery | Documentation site | Tool listing with descriptions + parameter schemas |
| Batch operations | Sequential calls | Batch endpoint accepting array of operations |
| Idempotency | "Just retry" | Idempotency keys to prevent duplicate transactions |
| Confirmation | Visual feedback (UI) | Polling endpoint or webhook callback |
| Context | Knows what they're doing | Needs descriptions on every parameter and return field |

**Recommendation:** veil should natively support an agent mode:
- All errors include a machine-readable `code`, `field`, and `suggestion` property
- All responses have a stable JSON schema (no polymorphic return types)
- Batch method variants: `batchReadMapping(keys[])`, `batchGetBalance(addresses[])`
- Idempotency support for write operations
- Verbose parameter descriptions in JSDoc (LLMs read these)

---

### 2.4 Autonomous Agent Transaction Security (P1 -- Q3)

**The gap:** When AI agents execute transactions autonomously, new security concerns arise that do not exist for human-operated wallets:

1. **Spending limits:** Agents need configurable per-transaction and per-session spending caps
2. **Allowlists:** Restrict which programs/functions an agent can call
3. **Approval flows:** High-value transactions should require human approval (human-in-the-loop)
4. **Audit logging:** Every agent action must be logged with context (which agent, which prompt, which tool call)
5. **Key isolation:** Agent keys should be separate from user keys, with limited permissions

**What exists:**
- Coinbase AgentKit + World integration uses World ID to verify a human is behind every agent
- BitGo's MCP server uses institutional custody controls
- The x402 protocol (Coinbase + Cloudflare) enables stablecoin micropayments with per-request authorization

**Recommendation:** Build `@aleo-dev-toolkit/agent-guard`:
- Transaction policy engine: define rules like "max 10 ALEO per transaction", "only call token.transfer", "require approval above 100 ALEO"
- Wraps any WalletClient with policy enforcement
- Audit log output (structured JSON per action)
- Integration with human-in-the-loop approval (webhook or CLI prompt)

---

### 2.5 Agent Discovery and Composition (P1 -- Q3)

**The gap:** When an agent encounters an Aleo program on-chain, it has no way to understand what the program does, what its functions expect, or how to compose multiple program calls into a workflow. There is no machine-readable program metadata.

**Recommendation:**
1. **Program metadata standard:** Define an on-chain or off-chain metadata format for Aleo programs that includes human-readable descriptions, parameter descriptions, and example invocations. Think NatSpec for Leo.
2. **Tool composition helpers:** Utility functions that help agents chain operations: "transfer tokens, then call program X, then verify mapping state" as a composable pipeline.
3. **Program discovery endpoint:** An API that returns all deployed programs matching certain criteria (e.g., "token programs", "DeFi programs") with their metadata.

---

### 2.6 Structured Output for Agent Reasoning (P1 -- Q3)

**The gap:** Agents need to reason about Aleo-specific concepts (records, proving, private vs public state). Current APIs return raw data without context that would help an agent decide what to do next.

**Recommendation:** Enrich API responses with agent-useful metadata:
- Transaction responses should include `nextSteps: string[]` suggesting follow-up actions
- Error responses should include `possibleCauses: string[]` and `suggestedFix: string`
- Balance responses should distinguish `publicBalance`, `privateBalance (records)`, and `pendingBalance`
- Record responses should indicate whether a record is `spent`, `unspent`, or `pending`
- Fee estimation responses should include `estimatedProvingTime` so agents can plan async workflows

---

### 2.7 Multi-Chain Agent Workflows (P2 -- later)

**The gap:** Many agent workflows will span multiple chains: "Bridge USDC from Ethereum to Aleo, swap for ALEO, then call a private program." No tooling exists for agents to compose cross-chain operations involving Aleo.

**Recommendation:** Build bridge/cross-chain adapters that expose MCP tools for:
- Querying Aleo balances alongside EVM balances
- Initiating bridge transfers (when bridge infrastructure exists)
- Monitoring cross-chain transaction completion
- Unified address book across chains

This depends on bridge infrastructure maturing and is lower priority.

---

## Priority Roadmap

### Q2 2026 (P0 -- Must Have)

1. **veil core** -- unified TypeScript SDK (already in development)
2. **MCP server** -- wrap veil in MCP tools for agent access
3. **Agent tool schemas** -- OpenAI / LangChain / Vercel AI format exports
4. **Wallet Connect Kit** -- React components for wallet connection UI
5. **Enhanced testing** -- TypeScript test runner integrated with veil

### Q3 2026 (P1 -- Should Have)

6. **React hooks** (`@veil/react`) -- wagmi-equivalent hooks
7. **Transition event listener** -- `watchTransition()` in veil
8. **Program codegen CLI** -- TypeScript bindings from Leo source
9. **Agent transaction guard** -- spending limits, allowlists, audit logging
10. **Deployment pipeline** -- scripted deploys with environment management
11. **Local devnet improvements** -- pre-funded accounts, state snapshots

### Q4 2026+ (P2 -- Nice to Have)

12. **Hosted indexer service** -- The Graph equivalent for Aleo
13. **Security analysis tooling** -- Leo linter and static analysis
14. **Program registry** -- OpenZeppelin-equivalent for Leo
15. **Multi-chain agent workflows** -- cross-chain composition tools
16. **Agent discovery protocol** -- on-chain program metadata standard

---

## Key Insight: The Agent-First Advantage

Aleo is behind Ethereum and Solana in developer tooling maturity. But it has an opportunity to leapfrog on agent tooling -- a category where no chain has a dominant position yet. By building MCP tools, structured agent schemas, and agent-safe transaction guards from day one (rather than retrofitting them later), the Aleo toolkit can become the most agent-friendly blockchain development platform.

The veil design already embraces this with its "every action ships with MCP tool + agent tool schema" philosophy. The gap analysis above extends this into a full ecosystem strategy.

---

## Sources

- [Provable GitHub Organization](https://github.com/ProvableHQ)
- [Aleo Developer Documentation](https://developer.aleo.org/)
- [Aleoscan Explorer](https://aleoscan.io/)
- [Leology Testing Framework](https://github.com/leology-org/leology)
- [MCP in 2026: 97 Million Downloads](https://news.bitcoin.com/mcp-in-2026-97-million-downloads-and-growing-crypto-infrastructure-from-bitgo-to-coingecko/)
- [BitGo MCP Server Launch](https://www.businesswire.com/news/home/20260323339524/en/BitGo-Launches-MCP-Server-Bringing-Institutional-Grade-Crypto-Infrastructure-to-AI-Agents)
- [Coinbase AgentKit](https://docs.cdp.coinbase.com/agent-kit/welcome)
- [RainbowKit](https://rainbowkit.com/docs/introduction)
- [wagmi](https://wagmi.sh/)
- [Solana vs Ethereum Developer War 2026](https://cryptoadventure.com/solana-vs-ethereum-in-2026-which-chain-is-winning-the-developer-war/)
- [Aleo Provable SDK Docs](https://developer.aleo.org/sdk/overview/)
- [Leo Testing Documentation](https://developer.aleo.org/guides/leo/testing/)
