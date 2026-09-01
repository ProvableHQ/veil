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

### Third person, imperative — never "you", "we", or "I"

Comments and JSDoc are written in the third person or the imperative mood.
Pronouns referring to the reader or author are banned: no "you", "your", "we",
"our", "I". Name the actor instead — "the caller", "a developer", "the wallet",
"the client" — or drop the actor entirely with an imperative.

```ts
// Good — imperative, no pronoun.
/** Use `getBlocks` for complete block contents. */
// Good — third person, the actor is named.
/** The caller supplies the proving configuration. */
// Bad — second person.
/** Use this when you need complete block contents. */
/** You supply the proving configuration. */
```

### Do not write "reach for"

"Reach for this when…" is a tic; it flags machine-written text. Say when the
symbol applies, or state the discriminating fact and let it choose:

```ts
// Good — states when it applies.
/** Applies when only the header is needed; `getBlock` returns full contents. */
// Good — imperative alternative.
/** Use for header-only queries; `getBlock` returns full contents. */
// Good — the contrast itself does the work.
/** Fetches the block header. `getBlock` fetches the full block. */
// Bad.
/** Reach for this when you need only the header. */
```

### Never "shape" — name the actual structure

"Shape" (and "shape of") is a vagueness word: it gestures at a structure
instead of stating it. Name the concrete variants, standards, or fields.

```ts
// Bad — "shape" avoids exactness.
/** The shape of token0 and token1 (`plain` or `wrapped`). */
// Good — plain language that describes the structure.
/**
 * Two token inputs in a pool can be Arc20, wrapped Arc20 tokens implementing
 * the Arc22 standard and have differing funding statuses.
 */
```

### Use canonical Aleo terms for ledger indexes

Keep the language plain when referring to variables used to index information
on the Aleo ledger, including any combination of transaction id, transition id,
transition index, and transaction index. Do not invent collective terms such as
"coordinates" for these values.

Invented collective terms fail for three reasons:

1. They erase the immediate context: what the values identify or order in the
   code being documented.
2. They introduce terminology that is not canonical to the Aleo blockchain.
3. They read like forced concision built from too many prepended adjectives.

```ts
// Bad — "coordinates" replaces the reason these fields are added.
/**
 * Adds chain-confirmed transaction coordinates to an indexed pool trade.
 *
 * @property blockHeight Aleo block height containing the transaction.
 * @property transactionIndex Transaction order within the Aleo block.
 */
type CanonicalTrade = IndexedPoolTrade & {
  blockHeight: number
  transactionIndex: number
}

// Good — states exactly what is added and why the caller needs it.
/**
 * Adds the block height and transaction index to the API trade type so the
 * trade event can be ordered precisely.
 *
 * @property blockHeight Block height containing the transaction.
 * @property transactionIndex Transaction order within the block.
 */
type CanonicalTrade = IndexedPoolTrade & {
  blockHeight: number
  transactionIndex: number
}
```

### Top-level action descriptions serve the caller, not the implementation

The description on an exported action documents what matters to the caller:
what the call does to their assets, why and when to call it, how to use it,
and the failure modes to plan for. It does not narrate internal dispatch,
compiler or language constraints, or logical flow — those belong on the
internal helper that implements them, with every term of art defined or
avoided. A side-effect note states the concrete effect ("reads the pool and
submits one transaction"); a stamped tagline like "Pure and local" on an
action description reads as marketing and says nothing.

```ts
// Bad — internal flow, undefined jargon, and a tagline. The caller does not
// care about Leo input rules, and learns nothing about their own funds.
/**
 * Picks which of the router's 14 rebalance transitions to call.
 *
 * Leo transitions cannot take optional inputs, so the router deploys a
 * separate transition per input layout and names it after the layout: the
 * shape of token0 and token1 (`plain`, or `wrapped` — a pool token backed by
 * an underlying asset, which adds proof inputs), then the funded sides
 * (`none`, `fund0`, `fund1`, `both`). When both tokens have the same shape,
 * funding either side is the same layout, so a single `one` transition
 * replaces `fund0`/`fund1`. Pure and local.
 */

// Good — relevance to the caller, usage instructions, and the key
// considerations: atomicity, what a revert costs, and how to reduce reverts.
/**
 * Rebalances token positions in a pool in a single transaction.
 *
 * If a transaction is successful, this function burns the old position,
 * collects the principal and accrued fees, optionally adds funds from the
 * caller's private balance, and mints the new position. The operation is
 * atomic, so failed transactions abort all operations, leaving the pool in
 * the same state before the call. Callers should specify independently
 * either the liquidityTarget and compute the required token balances to
 * satisfy that target, or the max amount of token0 and token1 and solve for
 * the liquidity.
 *
 * Note every derived amount is a function of the pool price at the block
 * where a transaction executes. If any trade moves the pool price between
 * building and execution, the on-chain assertions fail and the whole
 * transaction reverts — no funds move, but the caller pays the transaction
 * fee. Expect rebalances on active pools to occasionally revert and in those
 * cases, simply rebuild and resubmit. Ensure to set deadlineBlocks low to
 * minimize this risk.
 */
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
| First/second person | "you", "your", "we", "our", "I" | "the caller", "a developer", or imperative mood |
| "Reach for" | "Reach for this when…" | "Applies when…", "Use for…", "Suited to…", or state the discriminating fact |
| "Shape" | "the shape of token0 (`plain` or `wrapped`)" | name the structure: the standards, variants, or fields |
| Invented Aleo terms | "transaction coordinates" | name the block height, transaction index, transition id, or other exact value and state why it is needed |
| Implementation narration | Leo/compiler constraints, dispatch tables, "Pure and local" taglines on actions | what the call does to the caller's assets, usage, and failure modes |
