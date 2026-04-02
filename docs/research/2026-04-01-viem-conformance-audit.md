# aleo-viem vs viem Conformance Audit

**Date:** 2026-04-01
**Status:** Deferred — prototype works, these are the fixes needed before release

## Summary

The prototype gets the API shape right (same method names, concepts, decorator pattern) but misses viem's type architecture — the generics, factory patterns, and typed RPC schema that make viem feel like a typed SDK.

## Red — Must Fix Before Release

### 1. Transport Factory Pattern
- **viem:** `http()` returns a *function* `(params) => { config, request, value }`. The client calls it during init, passing chain/account context. This lets the transport resolve URLs per-chain.
- **aleo-viem:** Returns a flat `{ config, request }` object. Can't adapt to the client that consumes it. The `network` param on `http()` is a workaround.
- **Fix:** Make transports return `(clientParams: { chain, account, pollingInterval }) => TransportConfig`. Update `createClient` to call the transport function.

### 2. Chain Type Missing
- **viem:** `Chain` type with `id`, `name`, `nativeCurrency`, `rpcUrls`, `blockExplorers`, `contracts`, `testnet`. Created with `defineChain()`. Used as `chain: mainnet` on the client. HTTP transport gets its URL from `chain.rpcUrls.default.http[0]`.
- **aleo-viem:** No Chain type. Network is `'mainnet' | 'testnet'` string on `http()` config.
- **Fix:** Define `Chain` type, create `aleoMainnet`/`aleoTestnet`/`aleoLocalnet` chain definitions. Add `chain` to Client. Transport derives URL from chain.

### 3. Client Generics
- **viem:** `Client<Transport, Chain, Account, RpcSchema, Extended>` — five generics flowing through `PublicActions<Transport, Chain, Account>`, every action, and the `extend()` return type.
- **aleo-viem:** Plain `Client` with no generics. No type narrowing anywhere.
- **Fix:** Add generics to Client, PublicClient, WalletClient, all decorators, and all action functions. This is the most invasive change.

### 4. Error Structure
- **viem:** `BaseError` has `shortMessage`, `details`, `metaMessages: string[]`, `docsPath`, `docsBaseUrl`, `version`, and `walk()` method for traversing error cause chains.
- **aleo-viem:** `BaseError` extends `Error` with just message + ErrorOptions. Plain concatenated strings.
- **Fix:** Add `shortMessage`, `details`, `metaMessages`, `docsPath`, `walk()` to BaseError. Update all error subclasses.

### 5. Typed RPC Schema
- **viem:** `request({ method, params })` where method is a union of known RPC methods with typed params/returns per method. `RpcSchema` generic enables autocomplete.
- **aleo-viem:** `method: string`, `params?: unknown`, `Promise<unknown>` — fully untyped. Custom method names (`'getBalance'`, `'getBlock'`) don't correspond to any standard.
- **Fix:** Define an Aleo RPC schema type mapping method names to param/return types. Consider aligning method names with the actual Aleo REST API paths or a future Aleo JSON-RPC spec.

## Yellow — Address Eventually

### 6. Account | Address Union
- viem lets you pass a plain address string where an account is expected (auto-wraps to JsonRpcAccount). We require full account objects.
- Also: viem allows per-action account overrides. We don't.

### 7. Decorator Generics
- Our `publicActions(client: Client)` loses all type info. Should be `publicActions<T, C, A>(client: Client<T, C, A>)`.

### 8. getContract Missing `simulate`
- viem's getContract has `read`, `write`, `simulate`, `estimateGas`, `getEvents`, `watchEvent`, `createEventFilter`. We only have `read` and `write`.
- Aleo has dry-run capabilities that could map to `simulate`.

### 9. proving/records Scoping
- `proving` and `records` are on the base `Client` type. PublicClients carry these as `undefined`. Should be scoped to WalletClient or handled via `extend()`.

### 10. Client `type` Discriminant
- viem clients have a `type` field (`'publicClient'`, `'walletClient'`) for runtime discrimination. We don't.

### 11. Subpath Exports
- viem has `viem/chains`, `viem/accounts`, `viem/actions`, `viem/utils`, etc. We only have `.`, `./agent`, `./mcp`. Add more as the library grows.

## Green — Already Matches

- Naming conventions (GetBalanceParameters, GetBalanceReturnType, etc.)
- Action structure (standalone functions, first arg is client)
- `extend()` method on Client
- Decorator runtime pattern (return object with bound methods)
- Transport function names (`http`, `custom`, `fallback`)
- Aleo-specific additions (`decrypt`, `requestRecords`, `transfer`, `executeTransaction` alias) are justified and don't conflict with viem patterns

## Recommended Fix Order

1. Chain type + defineChain (smallest change, biggest "feels like viem" payoff)
2. Transport factory pattern (chain feeds into transport)
3. Error structure (easy, high usability impact)
4. Client generics (most work, makes everything type-safe)
5. Typed RPC schema (completes the type story)

Items 1-3 can be done independently. Item 4 touches every file. Item 5 depends on 4.
