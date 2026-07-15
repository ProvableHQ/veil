import { getProgram, type Client } from '@provablehq/veil-core'
import { DEFAULT_PROGRAM } from '../constants.js'

/**
 * Parameters for {@link resolveDexImports}.
 *
 * @property tokenPrograms Token wrapper programs the call dispatches into
 *   (e.g. both pool tokens' `wrapper_program`s). Duplicates are collapsed.
 * @property program shield_swap program whose declared imports are added.
 *   Defaults to `DEFAULT_PROGRAM`.
 */
export type ResolveDexImportsParameters = {
  tokenPrograms: string[]
  program?: string
}

/**
 * Builds the `imports` map a shield_swap write needs: the given token
 * programs plus the DEX program's own declared imports.
 *
 * The prover resolves the import closure of the sources it is handed and
 * the dynamic-dispatch (`IARC20@(…)`) callees named in `imports`, but not
 * the main program's static imports — a swap or mint submitted with only
 * the token programs fails with "its import … must be added first" (e.g.
 * `test_shield_swap_multisig_core.aleo`). Every write action's `imports`
 * parameter accepts this function's result directly.
 *
 * Hits the network: one program fetch per unique entry.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param params Token programs and the optional program override.
 * @returns Program id → source, ready for a write action's `imports`.
 *
 * @example
 * const imports = await resolveDexImports(client, {
 *   tokenPrograms: [pool.token0_info.wrapper_program, pool.token1_info.wrapper_program],
 * })
 * const handle = await swap(client, { poolKey, tokenInId, amountIn, tokenInProgram, imports })
 */
export async function resolveDexImports(
  client: Client,
  params: ResolveDexImportsParameters,
): Promise<Record<string, string>> {
  const program = params.program ?? DEFAULT_PROGRAM
  const imports: Record<string, string> = {}
  for (const p of new Set(params.tokenPrograms)) {
    imports[p] = await getProgram(client, { programId: p })
  }
  // The DEX program's static imports, declared as `import <id>;` lines.
  const dexSource = await getProgram(client, { programId: program })
  for (const match of dexSource.matchAll(/^import ([\w.]+);/gm)) {
    const dep = match[1]!
    if (!imports[dep]) imports[dep] = await getProgram(client, { programId: dep })
  }
  return imports
}
