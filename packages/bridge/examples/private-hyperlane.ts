import type { Client } from '@provablehq/veil-core'
import {
  hyperlanePrivateClaimGrants,
  hyperlanePrivateTransferGrants,
  hyperlane,
  type BridgePlan,
  type BridgeRegistry,
  type BridgeCheckpoint,
  type BridgeClient,
  type BridgeProgress,
  type HyperlaneOptions,
  type QuoteParameters,
  type HyperlanePrivateTransferOptions,
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
    // Save each claim checkpoint so recovery can observe the transaction or
    // rebroadcast its encrypted proved bytes after an interrupted submission.
    const claim = await bridge.complete({ progress, onCheckpoint: options.save })
    progress = await bridge.wait({ progress: { next: 'wait', plan: quote.plan, receipt: claim.receipt } })
  }
  if (progress.next !== 'done') throw new Error('Retain the latest checkpoint and continue through recover, wait, or complete')
  return { quote, grants }
}


/**
 * Recovers a private Hyperlane claim from Aleo state without submitting a transaction.
 * A funded claim needs only the checkpoint's original intent and reviewed route;
 * source transaction and message ids are optional. The issuing wallet retains the secret.
 * @param bridge Supplies the reviewed registry and destination Aleo network access.
 * @param checkpoint Supplies the original intent, encoding, route, and any prepared claim bytes or submitted claim id.
 * @returns Progress ready for explicit completion, waiting for funds, or observing a submitted claim.
 * @throws Error When the checkpoint, route, or Aleo mapping read is invalid.
 * @example const progress = await recoverPrivateHyperlaneExample(bridge, checkpoint)
 */
export async function recoverPrivateHyperlaneExample(bridge: BridgeClient, checkpoint: BridgeCheckpoint): Promise<BridgeProgress> {
  if (checkpoint.intent.bridgeProtocol !== 'hyperlane' || !checkpoint.intent.hyperlane) {
    throw new Error('Supply the original private Hyperlane intent and encoding')
  }
  // Do not requote or repeat a source transfer. Recovery checks saved claim ids
  // before claimable state; complete() reuses prepared bytes when available.
  return bridge.recover({ checkpoint })
}


/**
 * Inspects private outbound token deductions and both dispatch hook payments without signing.
 * Requires an injected registry with reviewed private ABI and exact fee mapping metadata.
 * @param publicClient Supplies Aleo reads for the reviewed source network.
 * @param options Supplies the registry and outbound plan whose amount is the gross token spend.
 * @returns Net destination tokens and separate gross token, dispatch credits, and unknown execution fee requirements.
 * @throws Error When the deployment, on-chain token fee, hook configuration, or arithmetic is invalid.
 * @example const quote = await quotePrivateHyperlaneOutboundExample(publicClient, { registry, plan })
 */
export async function quotePrivateHyperlaneOutboundExample(publicClient: Client, options: { registry: BridgeRegistry; plan: BridgePlan }) {
  // The included protocol fee reduces net destination tokens; the token record
  // covers the gross spend. Execution uses the explicit private outbound path below.
  return hyperlane.aleo.quotePrivateTransfer(publicClient, options)
}


/**
 * Inspects a private outbound quote and optionally executes and follows the transfer.
 * Requires a reviewed private deployment, signer proof and record grants, and a
 * destination balance reader. Defaults to inspection without signing or moving funds.
 * @param bridge Supplies bound source and destination clients and the reviewed registry.
 * @param plan Supplies the original gross token amount and external-chain recipient.
 * @param funding Supplies the displayed private quote and optional local record or proof overrides.
 * @param options Enables execution explicitly and optionally persists each recovery checkpoint. Defaults to inspection only.
 * @returns The quote and signer grant, plus current progress when execution is enabled.
 * @throws Error When preparation or execution fails; a submitted-error checkpoint must be recovered before retrying.
 * @example await runPrivateHyperlaneOutboundExample(bridge, plan, { quote }, { execute: true, save })
 */
export async function runPrivateHyperlaneOutboundExample(
  bridge: BridgeClient,
  plan: BridgePlan,
  funding: HyperlanePrivateTransferOptions,
  options: { execute?: boolean; save?: (checkpoint: BridgeCheckpoint) => void | Promise<void> } = {},
) {
  const grants = hyperlanePrivateTransferGrants({ registry: bridge.registry, plan })
  if (!options.execute) return { quote: funding.quote, grants }
  const result = await bridge.execute({ plan, hyperlanePrivateTransfer: funding, onCheckpoint: options.save })
  const progress = await bridge.wait({ progress: { next: 'wait', plan, receipt: result.receipt } })
  return { quote: funding.quote, grants, progress }
}
