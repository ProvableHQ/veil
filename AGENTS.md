# Veil

Veil is the Aleo SDK (`@provablehq/veil-*` packages).

## Using Veil

To build on Veil in your own project, see the [README](./README.md) and the
documentation site under [`site/`](./site). This section maps the packages to
what you are building; each package's own README carries the API and examples.

Every package builds on `@provablehq/veil-core`. What you add to it depends on where the
signing keys live and what you are integrating.

### Packages

| Package | Reach for it when | Docs |
| --- | --- | --- |
| `@provablehq/veil-core` | You want a typed, viem-style client to read Aleo state or write to contracts. The foundation every other package extends. Ships agent tool schemas (`@provablehq/veil-core/agent`) and MCP tools (`@provablehq/veil-core/mcp`). | [README](./packages/core/README.md) |
| `@provablehq/veil-react` | You are building a browser dApp and want React context + hooks (`VeilProvider`, `useVeilWallet`) over a connected wallet. | [README](./packages/react/README.md) |
| `@provablehq/veil-wallet-adapter` | You need the framework-agnostic layer that turns a Provable/Aleo wallet adapter (Shield, Leo, Puzzle, Fox) into a Veil account. `@provablehq/veil-react` wraps this; reach for it directly outside React. | [README](./packages/wallet-adapter/README.md) |
| `@provablehq/veil-sdk` | Your code holds a private key directly (bots, scripts, servers, CI) and must sign and prove locally. Pulls in the Provable WASM SDK. | [README](./packages/provable-sdk/README.md) |
| `@provablehq/shield-swap-sdk` | You are integrating the Shield Swap AMM/DEX — swaps, liquidity, pool reads. Ships agent tool schemas (`@provablehq/shield-swap-sdk/agent`) and MCP tools (`@provablehq/shield-swap-sdk/mcp`). | [README](./packages/shield-swap/README.md) |
| `@provablehq/veil-leo` | You build, compile, or deploy Leo programs from TypeScript — including compiling programs during testing, where it pairs with `@provablehq/veil-devnode` to build and deploy against a local node. Requires the `leo` binary on `PATH`. | [README](./packages/leo/README.md) |
| `@provablehq/veil-codegen` | You want typed TypeScript bindings generated from a program ABI. Ships the `veil-codegen` CLI; use it as a build-time dev dependency. | [README](./packages/codegen/README.md) |
| `@provablehq/veil-devnode` | You run a local Aleo node in tests or local development. Requires the `aleo-devnode` binary on `PATH`. | [README](./packages/devnode/README.md) |

`@provablehq/veil-bridge` (cross-chain bridge client) is in preview and not yet published.

### Common setups

- **Building a frontend dApp.** Install `@provablehq/veil-react` and the wallet adapters
  you support. The user's wallet holds the keys and proves, so your app carries
  no private key or proving config. `@provablehq/veil-react` pulls in `@provablehq/veil-core` and
  `@provablehq/veil-wallet-adapter` for you.

- **Giving an agent the ability to use Aleo.** Start from `@provablehq/veil-core` plus its
  `@provablehq/veil-core/agent` (tool schemas) and `@provablehq/veil-core/mcp` (MCP tools) entry
  points. If the agent holds its own key and signs unattended, add
  `@provablehq/veil-sdk`. For DEX actions, add `@provablehq/shield-swap-sdk` and its
  `/agent` and `/mcp` entry points.

- **Integrating Aleo into a CLI, server, or custodial service.** Use
  `@provablehq/veil-core` with `@provablehq/veil-sdk` — you hold the private key and sign and
  prove locally (delegated proving or fully local). Add `@provablehq/veil-leo` to build or
  deploy programs, and `@provablehq/veil-codegen` to generate typed bindings for the
  contracts you call.

- **Integrating Shield Swap.** Always start with `@provablehq/shield-swap-sdk` on top of a
  client, then pick the client by where the keys live:
  - *In a frontend* — pair it with `@provablehq/veil-react`; the connected wallet signs and
    proves.
  - *In an agent trader* — pair it with `@provablehq/veil-sdk` and the
    `@provablehq/shield-swap-sdk/agent` and `/mcp` tooling.
  - *In a programmatic trader or bot* — pair it with `@provablehq/veil-sdk`
    (local key, delegated or local proving). Read-only pool and price queries
    need only a transport — no key, proving, or scanner.

### Registering with the Provable API

Delegated proving (DPS) and the hosted Record Scanner Service authenticate
with a consumer id and API key issued by the Provable API
([registration](https://docs.provable.com/docs/api/services/get-auth-register),
[JWT issuance](https://docs.provable.com/docs/api/services/issue-jwt)).

1. Register a consumer (one-time):

   ```sh
   curl -X POST https://api.provable.com/consumers \
     -H 'Content-Type: application/json' \
     -d '{"username": "<handle>"}'
   ```

   The response carries the credentials: `consumer.id` (the consumer id) and
   `key` (the API key). Store both — the key is not retrievable later.

2. Requests authenticate with a short-lived JWT minted from those credentials:

   ```sh
   curl -X POST https://api.provable.com/jwts/<consumer-id> \
     -H 'X-Provable-API-Key: <api-key>'
   ```

   The JWT arrives in the `Authorization` response header, Bearer-prefixed.
   The SDK mints and refreshes JWTs automatically — pass `consumerId` and
   `apiKey` to `createProvingConfig`, `createRemoteScanner`, or
   `createStandaloneScanner` and never handle JWTs directly.

The keyed integration tests read these credentials from `ALEO_CONSUMER_ID`
and `ALEO_DPS_API_KEY`.

## Contributing to Veil

If you are changing this repo — editing, adding to, or refactoring any `@provablehq/veil-*`
package — the contributor constraints are **required reading and binding**:

@.agents/contributors.md

They are also at [`.agents/contributors.md`](./.agents/contributors.md) for any
tool that does not resolve the import above.
