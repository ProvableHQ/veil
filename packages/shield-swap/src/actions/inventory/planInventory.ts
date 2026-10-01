import { planRecordInventory, getCode, checkProgramConformance, type Client, type InventoryPlan, type InventoryTarget, type RecordAsset } from '@provablehq/veil-core'
import type { ApiClient } from '../../api/client.js'
import { tokenData } from '../../utils/tokens.js'
import { detectTokenStandard } from '../../utils/detectTokenStandard.js'

/**
 * Defines the DEX token and desired spendable record shape.
 * @property token Token symbol or DEX token id.
 * @property target Desired count, minimum amount and distribution in underlying base units.
 * @property api Token metadata API; the decorator supplies its configured API.
 * @property maxTransactions Maximum planned operations, defaults to 100.
 */
export type PlanInventoryParameters = { token: string; target: InventoryTarget; api: ApiClient; maxTransactions?: number }

/**
 * Plans inventory for a DEX token's underlying asset, using core record tooling.
 * Resolves metadata and validates the deployed token interface; never signs.
 * @param client Account client, optionally extended with recordActions.
 * @param params Token, target, API and optional operation limit.
 * @returns A core inventory plan for the underlying program, not the AMM wrapper.
 * @throws When token metadata or its supported underlying program cannot be resolved.
 * @example
 * const plan = await planInventory(client, { token: 'ALEO', target: { records: 4 }, api })
 */
export async function planInventory(client: Client, params: PlanInventoryParameters): Promise<InventoryPlan> {
  const token = await tokenData(params.api, params.token)
  const program = token.underlyingProgram
  if (!program) throw new Error(`Token ${token.symbol} has no underlying record program`)
  let standard: RecordAsset['standard'] | 'none' = program === 'credits.aleo' ? 'credits' : await detectTokenStandard(client, { programId: program, engine: 'pure' })
  if (standard === 'none') {
    const source = await getCode(client, { programId: program })
    for (const candidate of ['arc22', 'arc20'] as const) {
      if (checkProgramConformance(source, candidate).violations.every((violation) => violation.kind === 'missing_view')) { standard = candidate; break }
    }
  }
  if (standard === 'none') throw new Error(`Unsupported inventory asset: ${program}`)
  const asset: RecordAsset = { program, standard }
  return planRecordInventory(client, { asset, target: params.target, maxTransactions: params.maxTransactions })
}
