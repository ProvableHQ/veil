# codegen

Pinned upstream sources and the scripts that turn them into typed code. Nothing
here ships (excluded by the package's `files: ["dist"]`) — these are build-time
inputs, checked in so generation is reproducible and upstream drift shows up as
a reviewable diff.

| Path | What | Generates |
| --- | --- | --- |
| `abi/` | `shield_swap` program bytecode (`.aleo`) + the ABI JSON (`leo abi` output) | `src/generated/shield_swap.ts` |
| `amm-api/` | the AMM indexer's OpenAPI spec | `src/indexer/openapi.ts` |
| `veil.config.json` | codegen config (ABI → output, `programId` target) | — |

Regenerate (run from the package root):

```sh
pnpm generate       # ABI → src/generated/shield_swap.ts
pnpm regen-abi      # refetch program bytecode + ABI into abi/
pnpm regen-openapi  # refetch the OpenAPI spec + regenerate src/indexer/openapi.ts
```

Note: `leo abi` can't parse `shield_swap_v0_0_1`'s older `constructor` dialect, so
bindings are shaped from the `v0_0_2` ABI while targeting `v0_0_1` via
`veil.config.json`'s `programId`. Both `.aleo` files are pinned for reference.
