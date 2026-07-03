# Veil Contributor Constraints

Constraints for **contributing to** the Veil monorepo (`@veil/*` packages) —
changing the SDK, not using it. They bind on every contribution, human or agent.
They are rules, not suggestions.

If you only want to *use* Veil in your own project, you do not need this file —
see the README and the documentation site under `site/`.

## Documentation

- Every public class, function, and exported symbol has a JSDoc comment.
- The first line is a one-sentence summary led by a present-tense verb ("Builds a
  deployment transaction"). Tooling shows the first paragraph, so do not bury the
  summary, and do not open with "This function is designed to…".
- Give one or two sentences of context: what it does and when to reach for it.
- Document every `@param`, `@returns`, and `@throws` by its consequence, not by
  restating its name. `options — The options for the transaction` is a failure.
- Do not repeat TypeScript types in tags. The signature already carries them;
  write `@param to …`, not `@param {string} to …`. Repeated types drift.
- State the default for every optional parameter if a default applies. Concisely state the case for when one would choose to use it.
  (`@param fee Optional fee in microcredits. Defaults to 0.`).
- Document units, widths, and bounds: microcredits rather than credits where applicable, valid
  ranges, and the numeric width (`number` for u64 and smaller, `bigint` for u128
  and larger).
- Note side effects: whether the call hits the network, signs, proves locally, or
  is pure and local.
- Document object-type fields with `@property` tags on the type's docblock, not
  with inline per-field comments.
- Include an `@example` that compiles in context.
- `@deprecated` carries a migration path — say what to use instead and when it is
  removed, never just "do not use".
- In prose docs, state facts plainly, anchor unfamiliar concepts to known ones,
  explain why and when, address "a developer" or "the caller", and give hard
  rules emphasis (MUST / Do not).
- Do not write: (A) filler or throat-clearing, (B) restatements of the
  signature, (C) hype adjectives ("powerful", "seamless", "robust", "simply",
  "just"), (D) hedging or statements of the obvious ("it's important to note").
- Write concise, clear comments inside function/closure bodies explaining what blocks of code do.

See `.agents/voice.md` for verbatim good and bad examples.

## Veil is an interface

`@veil/core` defines capabilities as interfaces. Concrete platform bindings stay
behind those interfaces and stay optional and configurable. Do not hardcode one
platform into core action logic.

- **Network.** Chain access goes through a `transport`. Do not hardcode the
  Provable RPC URL or assume a network (testnet/mainnet) in core.
- **Wallet / signer.** Actions take an abstract `account`. Do not bake Shield- or
  Leo-wallet specifics into core.
- **Runtime.** Core stays node/browser/React Native agnostic. No `window`, `fs`,
  or environment-specific globals in core.
- **Framework.** React and any UI framework stay in `@veil/react`. Core never
  imports or assumes a framework.
- **Configuration shape.** When platform-agnosticism needs extra parameters or
  objects, express them as viem-shaped configuration — options objects, client,
  transport, and account config passed at construction, the `extend()` pattern —
  with sensible defaults. Do not bolt bespoke positional arguments onto
  functions. The common path stays clean; platform knobs live in the config
  object.

Before changing core, check: does this import a runtime global? assume a specific
wallet or wallet-calling mechanism? make a native binary mandatory? add a
positional parameter where a viem-style config object belongs?

## Repo-wide rules

- **Stop and get sign-off before changing a shared `core` interface or type, or
  before breaking backwards compatibility.** State what you want to change, which
  dependent packages and examples are affected, why it is necessary, and why
  there is no backward-compatible alternative. Then wait for approval. Do not
  proceed silently.
- Do not modify `@veil/core` or another package you depend on just to make your
  own package work. Surface it and justify it first.
- When you change a feature an example depends on, update the example in the same
  change. (`examples/e2e-demo.ts` and `apps/loyalty-dapp/` are required to stay
  in sync — see `CLAUDE.md`.)
- When you change something dependent packages rely on, update those dependents
  in the same change.
- When you change a `core` type, update every package that depends on that type.
- Avoid breaking backwards compatibility unless necessary. When it is necessary,
  declare the intent and the migration as part of the sign-off above.

## Commits

- Prefix every commit subject with a bracketed, capitalized type: `[Fix]`,
  `[Feat]`, `[Chore]`, `[Docs]`, `[Refactor]`, `[Test]`. Do NOT use the
  `fix:` / `feat:` / `chore:` colon style.
- Follow the prefix with a concise, imperative summary
  (`[Feat] Add delegated proving to the wallet client`).
- Do not add `Co-Authored-By` lines or any AI attribution to commits, PRs, or
  code.
