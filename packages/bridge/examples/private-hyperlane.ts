import {
  hyperlanePrivateClaimGrants,
  type BridgeCheckpoint,
  type BridgeClient,
  type BridgeProgress,
  type HyperlaneOptions,
  type QuoteParameters,
} from '@provablehq/aleo-bridge-sdk'

/**
 * Quotes a private Hyperlane transfer and optionally submits its source and destination transactions.
 *
 * The bridge must use a reviewed private-claim registry and an issuing wallet
 * connected with the grants returned by `hyperlanePrivateClaimGrants`. The
 * default reads fees only; execution spends source funds and destination gas.
 * @param bridge Supplies the reviewed registry, source signer, and issuing Aleo wallet.
 * @param intent Supplies endpoints, amount, recipient, and the original wallet-issued encoding.
 * @param options Controls execution and durable recovery. Defaults to quoting only; `save` is optional.
 * @returns The priced plan and required wallet grants after quoting or completed execution.
 * @throws Error When quoting fails, execution fails, or recovered source work needs explicit resumption.
 * @example
 * await runPrivateHyperlaneExample(bridge, {
 *   source: { chain: 'sepolia', asset: 'eth' }, destination: { chain: 'aleo-testnet', asset: 'eth' },
 *   amount: '0.001', recipient, hyperlane: { addressEncoding },
 * })
 */
export async function runPrivateHyperlaneExample(
  bridge: BridgeClient,
  intent: QuoteParameters & { hyperlane: HyperlaneOptions },
  options: { execute?: boolean; save?: (checkpoint: BridgeCheckpoint) => void | Promise<void> } = {},
) {
  const quote = await bridge.quote({ ...intent, bridgeProtocol: 'hyperlane', mintMode: 'private' })
  const grants = hyperlanePrivateClaimGrants({ registry: bridge.registry, plan: quote.plan })
  if (!options.execute) return { quote, grants }

  const execution = await bridge.execute({ plan: quote.plan, onCheckpoint: options.save })
  let progress: BridgeProgress = await bridge.wait({ progress: { next: 'wait', plan: quote.plan, receipt: execution.receipt } })
  if (progress.next === 'resume') throw new Error('Recover and explicitly resume the saved source approval before continuing')
  if (progress.next === 'failed') throw new Error(progress.error)
  if (progress.next === 'complete') {
    // The original wallet resolves the secret at input three and recipient
    // proofs at input four; the application stores neither private input.
    const claim = await bridge.complete({ progress, onCheckpoint: options.save })
    progress = await bridge.wait({ progress: { next: 'wait', plan: quote.plan, receipt: claim.receipt } })
  }
  if (progress.next !== 'done') throw new Error('Retain the latest checkpoint and continue through recover, wait, or complete')
  return { quote, grants }
}
