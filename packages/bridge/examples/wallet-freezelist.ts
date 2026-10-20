import {
  DEFAULT_BRIDGE_REGISTRY,
  parseDecimalAmount,
  xReserveBurnFreezelistProofGrant,
  type BridgePlan,
  type BridgeRegistry,
  type ExecuteParameters,
} from '@provablehq/aleo-bridge-sdk'
import type { AlgorithmGrant } from '@provablehq/veil-core'

/**
 * Prepares private USDCx burn inputs and a wallet grant without reading private data.
 * Obtain the plan from `bridge.quote`, pass the grant in the wallet connection's
 * `algorithmsAllowed`, then submit `parameters` through `bridge.execute` only
 * after authorization. The wallet must support the freezelist algorithm.
 * @param options Supplies the quoted plan and optional reviewed registry, defaulting to the packaged registry.
 * @returns A record request and exact private-burn proof grant; execution inserts the signer proof request automatically.
 * @throws BridgeError When the plan or reviewed freezelist deployment is unavailable.
 * @example
 * const { parameters, algorithmsAllowed } = createWalletBurnInputs({ plan: quote.plan })
 */
export function createWalletBurnInputs(options: { plan: BridgePlan; registry?: BridgeRegistry }): {
  parameters: ExecuteParameters
  algorithmsAllowed: AlgorithmGrant[]
} {
  const registry = options.registry ?? DEFAULT_BRIDGE_REGISTRY
  const algorithmsAllowed = [xReserveBurnFreezelistProofGrant({ registry, plan: options.plan })]
  const source = registry.assets.find(asset => asset.id === options.plan.sourceAsset.id)!
  // Grant construction above validates this source asset against the route.
  // Execution inserts the compliance request; the wallet resolves both inputs.
  return {
    algorithmsAllowed,
    parameters: {
      plan: options.plan,
      mode: 'private',
      userRecord: {
        type: 'record', program: source.privacy!.program, recordname: 'Token',
        filters: { amount: { gte: `${parseDecimalAmount(options.plan.amountIn, source.decimals)}u128` } },
      },
    },
  }
}
