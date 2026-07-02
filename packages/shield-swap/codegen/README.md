# codegen

Pinned upstream sources and the scripts that turn them into typed code. Nothing
here ships (excluded by the package's `files: ["dist"]`) — these are build-time
inputs, checked in so generation is reproducible and upstream drift shows up as
a reviewable diff.

| Path | What | Generates |
| --- | --- | --- |
| `abi/` | `shield_swap` program bytecode (`.aleo`) + the ABI JSON (`leo abi` output) | `src/generated/shield_swap.ts` |
| `amm-api/` | the AMM (DEX) API's OpenAPI spec | `src/api/openapi.ts` |
| `veil.config.json` | codegen config (ABI → output) | — |

Regenerate (run from the package root):

```sh
pnpm generate       # ABI → src/generated/shield_swap.ts
pnpm regen-abi      # refetch program bytecode + ABI into abi/
pnpm regen-openapi  # refetch the OpenAPI spec + regenerate src/api/openapi.ts
```

Bindings are generated from `shield_swap_v0_0_2.aleo` (the live deployment).
`shield_swap_v0_0_1.aleo` is pinned for reference (the previous version;
regenerating its ABI needs `leo` ≥ 4.3 for its `constructor` dialect).
