// ARC token-standard detection for DEX token onboarding and routing checks.

import { getCode, checkProgramConformance, type Client } from '@provablehq/veil-core'
import { tryLoadSdk } from './sdk.js'

/** The token interface a program implements, if any. */
export type TokenStandard = 'arc20' | 'arc22' | 'none'

/**
 * Parameters for {@link detectTokenStandard}.
 *
 * @property programId Deployed program to fetch and analyze. Hits the network.
 * @property source Full program text to analyze locally instead.
 * @property engine Which checker runs. `'auto'` (default) prefers the wasm
 *   SDK's `Program.isArc20()/.isArc22()` when the optional `@provablehq/sdk`
 *   peer loads (snarkVM's own parser — fully deterministic) and falls back
 *   to veil-core's pure-JS structural checker; `'pure'` always uses the
 *   pure-JS checker; `'wasm'` requires the SDK and throws when absent.
 */
export interface DetectTokenStandardParameters {
  programId?: string
  source?: string
  engine?: 'auto' | 'pure' | 'wasm'
}

/**
 * Determines whether a program implements the ARC-22 or ARC-20 token
 * interface.
 *
 * ARC-22 is checked first — its transfer signatures differ from ARC-20's, so
 * the two cannot both match; a program matching neither is `'none'`. With
 * `programId` the program text is fetched from the connected node; with
 * `source` the check runs locally.
 *
 * @param client Client whose transport serves the fetch when `programId` is
 *   used.
 * @param params Program to analyze and the engine preference.
 * @returns The implemented standard, or `'none'`.
 *
 * @example
 * const standard = await detectTokenStandard(client, { programId: 'test_usdcx_stablecoin.aleo' })
 * // 'arc22'
 */
export async function detectTokenStandard(
  client: Client,
  params: DetectTokenStandardParameters,
): Promise<TokenStandard> {
  const source =
    params.source ?? (params.programId ? await getCode(client, { programId: params.programId }) : undefined)
  if (source === undefined) {
    throw new Error('Provide exactly one of `programId` or `source`.')
  }

  const engine = params.engine ?? 'auto'
  if (engine !== 'pure') {
    const sdk = await tryLoadSdk()
    if (sdk) {
      const program = sdk.Program.fromString(source)
      if (program.isArc22()) return 'arc22'
      if (program.isArc20()) return 'arc20'
      return 'none'
    }
    if (engine === 'wasm') {
      throw new Error('detectTokenStandard with engine "wasm" requires the optional @provablehq/sdk peer')
    }
  }

  if (checkProgramConformance(source, 'arc22').conforms) return 'arc22'
  if (checkProgramConformance(source, 'arc20').conforms) return 'arc20'
  return 'none'
}
