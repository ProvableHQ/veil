# Veil Documentation Voice — Examples

Reference for the documentation rules in `AGENTS.md`. The rules bind; this file
shows what they look like in practice. Derived from the ProvableHQ SDK:
`sdk/src/program-manager.ts` (JSDoc) and `docs/guide/05_transfers.md`,
`docs/guide/06_executing_programs.md` (prose).

## JSDoc

Lead with a verb in the present tense, give one or two sentences of context,
and document each `@param` / `@returns` / `@throws` by its consequence.

### Good

```ts
/**
 * Builds a deployment transaction for submission to the Aleo network.
 *
 * Signs locally and submits to the configured transport, so it reaches the
 * network and costs a fee.
 *
 * @param program Program source code.
 * @param priorityFee Optional priority fee in microcredits (u64). Defaults to 0.
 * @param privateFee Use a private record to pay the fee. If false this uses the
 *   account's public credit balance.
 * @param feeRecord Optional fee record to spend for the fee.
 * @returns The transaction id of the deployed program.
 * @throws If the account cannot cover the fee.
 *
 * @example
 * const id = await programManager.buildDeploymentTransaction(source, 1, true);
 */
```

Why it works: the description starts with "Builds"; the second sentence names the
side effect (network + fee); `priorityFee` gives units and a default; `privateFee`
explains the branch its value selects; the `@example` compiles against the
documented call. Types are not repeated in the tags — the TypeScript signature
already carries them.

### Bad

```ts
/**
 * This function is designed to allow you to easily build a powerful deployment
 * transaction in a seamless way. It's important to note that it returns a result.
 *
 * @param {string} options The options for the deployment transaction.
 * @param {number} fee The fee.
 * @returns {string} The result.
 */
```

Why it fails: "This function is designed to" is filler (A); "powerful" and
"seamless" are hype (C); `options — The options for the deployment transaction`
restates the name (B); `fee — The fee` gives no units, width, or default (B);
"It's important to note" hedges (D); the `{string}`/`{number}` types duplicate the
signature and will drift; no `@example`.

## More JSDoc rules in practice

### Units, widths, and bounds

```ts
// Good — units, width, and range stated.
/** @param amount Amount in microcredits (u64), 1..=u64::MAX. */
// Bad — caller has to guess credits vs microcredits, and the width.
/** @param amount The amount. */
```

Use `number` for u64 and smaller, `bigint` for u128 and larger.

### Defaults for optional params

```ts
// Good.
/** @param network Optional target network. Defaults to "testnet". */
// Bad — the default is hidden in the body.
/** @param network Optional target network. */
```

### Side effects

```ts
// Good — the caller learns it hits the network and signs.
/** Submits the transaction to the configured transport and waits for acceptance. */
// Good — the caller learns it is pure and local.
/** Computes the blinded address locally. Does not touch the network. */
```

### Object-type fields with `@property` on the docblock

```ts
// Good — fields documented with @property on the type's docblock.
/**
 * Parameters for a public transfer.
 *
 * @property to Recipient address.
 * @property amount Amount in microcredits (u64).
 * @property priorityFee Optional priority fee in microcredits. Defaults to 0.
 */
export type transfer_public_params = {
  to: string;
  amount: number;
  priorityFee?: number;
};

// Bad — inline per-field comments instead of @property.
export type transfer_public_params = {
  to: string; // recipient
  amount: number; // amount
  priorityFee?: number; // fee
};
```

### `@deprecated` carries a migration path

```ts
// Good — says what to use instead.
/** @deprecated Use `writeContract` instead; this is removed in 0.3. */
// Bad — leaves the caller stranded.
/** @deprecated Do not use. */
```

## Prose (guides and tutorials)

State facts plainly. Anchor unfamiliar concepts to known ones. Explain why and
when. Address "a developer" or "the caller". Give hard rules emphasis.

### Good

> All value transfers on the Aleo Network are done by calling functions in the
> `credits.aleo` program. A user's total private balance consists of all unspent
> `credits` records the user owns. These records are analogous to UTXOs in
> Bitcoin. `initThreadPool` MUST be called once, before any other operation, and
> never again for the lifetime of the application.

Why it works: declarative; the Bitcoin analogy anchors an unfamiliar idea; the
hard rule is emphasized with MUST.

### Bad

> Veil provides a powerful and seamless way to easily transfer value. You can
> simply call the function and it will just work. It's worth noting that records
> are an important concept you should probably understand.

Why it fails: hype (C: "powerful", "seamless"), filler ("easily", "simply",
"just"), and hedging (D: "worth noting", "probably") — and it never says what a
record actually is.

## Quick reference

| Anti-pattern | Avoid | Use |
| --- | --- | --- |
| A. Filler | "This function is designed to allow you to…" | "Builds a deployment transaction." |
| B. Restating the signature | "`userId` — the user ID" | "`userId` — owner whose unspent records are summed." |
| C. Hype adjectives | "powerful", "seamless", "robust", "simply", "just" | (delete them) |
| D. Hedging / obvious | "It's important to note that…" | (state the fact directly) |
| Types in tags | `@param {string} to …` | `@param to …` (TS carries the type) |
| Bare optional | `@param fee Optional fee.` | `@param fee Optional fee in microcredits. Defaults to 0.` |
