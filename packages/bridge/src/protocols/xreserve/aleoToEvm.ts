import type { TransactionInput } from '@provablehq/veil-core'
import { BridgeError } from '../../errors/bridgeErrors.js'
import type {
  AleoWalletClient,
  ExecuteXReserveBurnParameters,
  XReserveBurnCall,
  XReserveBurnExecution,
} from '../../types/aleo.js'
import type { BridgeRegistry, BridgeReceipt } from '../../types/protocol.js'
import { formatDecimalAmount, parseDecimalAmount } from '../../utils/units.js'
import { evmAddressToXReserveBytes32, xReserveHexToAleoBytes } from '../../utils/xreserve.js'

const ETHEREUM_DESTINATION_DOMAIN = 0

function validatedRoute(registry: BridgeRegistry, params: ExecuteXReserveBurnParameters) {
  const { plan } = params
  if (plan.protocol !== 'xreserve' || plan.route.protocol !== 'xreserve') throw new BridgeError('USDCx burn requires an xReserve transfer plan')
  if (plan.registryVersion !== registry.version) throw new BridgeError(`Transfer plan uses registry ${plan.registryVersion}; expected ${registry.version}`)
  // Resolve programs, token metadata, domain, and fee from the current reviewed
  // registry. The saved transfer identifies the route but cannot replace a
  // current deployment review.
  const route = registry.routes.find((entry) => entry.id === plan.route.id)
  if (!route || route.protocol !== 'xreserve' || route.availability !== 'active') throw new BridgeError(`xReserve route is not executable: ${plan.route.id}`)
  const sourceChain = registry.chains.find((chain) => chain.id === plan.sourceAsset.chainId)
  const destinationChain = registry.chains.find((chain) => chain.id === plan.destinationAsset.chainId)
  if (sourceChain?.family !== 'aleo' || destinationChain?.family !== 'evm') throw new BridgeError('USDCx burn action requires an Aleo-to-Ethereum route')
  if (route.sourceAssetId !== plan.sourceAsset.id || route.destinationAssetId !== plan.destinationAsset.id) throw new BridgeError(`Transfer plan assets do not match configured route: ${route.id}`)
  const bridgeProgram = route.metadata?.bridgeProgram
  const wrapperProgram = route.metadata?.wrapperProgram
  const tokenProgram = route.metadata?.remoteToken
  const nativeDomain = route.metadata?.ethereumDestinationDomain
  const withdrawalFee = route.metadata?.withdrawalFeeAtomic
  if (typeof bridgeProgram !== 'string' || !bridgeProgram.endsWith('.aleo')) throw new BridgeError(`xReserve bridge program is invalid: ${route.id}`)
  if (typeof wrapperProgram !== 'string' || !wrapperProgram.endsWith('.aleo')) throw new BridgeError(`xReserve wrapper program is invalid: ${route.id}`)
  if (typeof tokenProgram !== 'string' || !tokenProgram.endsWith('.aleo')) throw new BridgeError(`xReserve token program is invalid: ${route.id}`)
  if (typeof withdrawalFee !== 'string' || !/^\d+$/.test(withdrawalFee)) throw new BridgeError(`xReserve withdrawal fee is invalid: ${route.id}`)
  if (nativeDomain !== ETHEREUM_DESTINATION_DOMAIN) throw new BridgeError(`xReserve Ethereum destination domain must be ${ETHEREUM_DESTINATION_DOMAIN}: ${route.id}`)
  return { route, bridgeProgram, wrapperProgram, tokenProgram, nativeDomain, withdrawalFeeAtomic: BigInt(withdrawalFee) }
}

function assertPrivateInputs(userRecord: TransactionInput | undefined, merkleProof: string | undefined, tokenProgram: string): asserts userRecord is TransactionInput {
  // A structured request lets a compatible wallet select the record without
  // exposing plaintext to the application. A literal record remains supported
  // for local accounts and wallets that do not implement record selection.
  if (userRecord == null) throw new BridgeError('private_burn requires a USDCx userRecord input')
  if (typeof userRecord === 'object') {
    if (userRecord.type !== 'record' || userRecord.program !== tokenProgram || userRecord.recordname !== 'Token') {
      throw new BridgeError(`private_burn record requests must select ${tokenProgram}/Token`)
    }
  }
  if (typeof merkleProof !== 'string' || !merkleProof.startsWith('[') || !merkleProof.endsWith(']')) {
    throw new BridgeError('private_burn requires an encoded [MerkleProof; 2] Aleo literal')
  }
}

/**
 * Builds the Aleo program call that begins a USDCx-to-USDC xReserve transfer.
 *
 * The result lets an application inspect the source program, public or private
 * funding mode, amount, withdrawal fee, and Ethereum recipient before a wallet
 * is involved. It does not contact Aleo, request a signature, or move funds.
 * Pauses, frozen accounts, and burn limits remain enforced by the source program
 * when the call is eventually submitted.
 *
 * @param registry Supported assets and reviewed xReserve deployments.
 * @param params Route, amount, Ethereum recipient, public or private funding preference, and private record proof when applicable.
 * @returns Exact Aleo program, transition, ordered inputs, atomic amount, destination domain, and encoded recipient.
 * @throws BridgeError When the route is unavailable, the amount cannot cover the withdrawal fee, the recipient is invalid, or private funding inputs are missing.
 *
 * @example
 * const call = buildBurnCall(registry, { plan, mode: 'public-as-signer' })
 */
export function buildBurnCall(
  registry: BridgeRegistry,
  params: ExecuteXReserveBurnParameters,
): XReserveBurnCall {
  const deployment = validatedRoute(registry, params)
  const mode = params.mode ?? 'private'
  if (mode !== 'public-as-signer' && mode !== 'public' && mode !== 'private') throw new BridgeError(`Unsupported USDCx burn mode: ${String(mode)}`)
  const amountAtomic = parseDecimalAmount(params.plan.amountIn, params.plan.sourceAsset.decimals)
  if (amountAtomic <= 0n) throw new BridgeError('USDCx burn amount must be greater than zero')
  if (amountAtomic <= deployment.withdrawalFeeAtomic) {
    const fee = formatDecimalAmount(deployment.withdrawalFeeAtomic, params.plan.sourceAsset.decimals)
    throw new BridgeError(`USDCx burn amount must exceed the ${fee} ${params.plan.sourceAsset.symbol} withdrawal fee`)
  }
  // Circle domains use a 32-byte recipient. Ethereum addresses occupy the low
  // 20 bytes and are left-padded with twelve zero bytes.
  const nativeRecipientBytes32 = evmAddressToXReserveBytes32(params.plan.recipient)
  const amount = `${amountAtomic}u128`
  const nativeDomain = `${deployment.nativeDomain}u32`
  const nativeRecipient = xReserveHexToAleoBytes(nativeRecipientBytes32, 32)

  if (mode === 'private') {
    // Private USDCx lives in the wrapper's Token record and requires the
    // freeze-list witness expected by private_burn.
    assertPrivateInputs(params.userRecord, params.merkleProof, deployment.tokenProgram)
    return {
      routeId: deployment.route.id,
      mode,
      program: deployment.wrapperProgram,
      function: 'private_burn',
      inputs: [params.userRecord, amount, nativeDomain, nativeRecipient, params.merkleProof!],
      amountAtomic,
      nativeDomain: deployment.nativeDomain,
      nativeRecipientBytes32,
    }
  }

  // Public balance funding uses the bridge program directly. The signer-bound
  // variant debits the connected account; `public` accepts the program's
  // explicit public-owner semantics.
  return {
    routeId: deployment.route.id,
    mode,
    program: deployment.bridgeProgram,
    function: mode === 'public' ? 'burn_public' : 'burn_public_as_signer',
    inputs: [amount, nativeDomain, nativeRecipient],
    amountAtomic,
    nativeDomain: deployment.nativeDomain,
    nativeRecipientBytes32,
  }
}

/**
 * Begins a USDCx-to-USDC transfer by burning USDCx on Aleo.
 *
 * The Aleo wallet proves, signs, and broadcasts the source burn, which commits
 * USDCx and incurs an Aleo transaction fee. After acceptance, the Aleo burn
 * attestation service forwards the withdrawal to Circle; no destination wallet
 * authorization is required.
 *
 * @param registry Supported assets and reviewed xReserve deployments.
 * @param client Aleo wallet that proves, signs, and broadcasts the source burn.
 * @param params Route, amount, Ethereum recipient, public or private funding preference, fee preference, and recovery callbacks.
 * @returns The Aleo transaction identifier and state needed to follow provider-managed delivery.
 * @throws BridgeError When the burn inputs are invalid or wallet submission fails.
 *
 * @example
 * const burn = await execute(registry, client, {
 *   plan,
 *   userRecord,
 *   merkleProof,
 * })
 */
export async function execute(
  registry: BridgeRegistry,
  client: AleoWalletClient,
  params: ExecuteXReserveBurnParameters,
): Promise<XReserveBurnExecution> {
  const call = buildBurnCall(registry, params)
  // Aleo wallets may finish proving before broadcasting. Forward that prepared
  // transaction so an application can persist the exact bytes and recover the
  // crash window without proving or burning again.
  const transactionId = await client.executeTransaction({
    program: call.program,
    function: call.function,
    inputs: call.inputs,
    privateFee: params.privateFee ?? false,
    onProgress: async (event) => {
      await params.onProgress?.(event)
      if (event.type === 'transaction-prepared') await params.onPrepared?.(event.transaction)
    },
  })
  if (!transactionId) throw new BridgeError('Aleo wallet returned an empty burn transaction id')
  // Source acceptance completes caller-authorized work. The public transaction
  // id is sufficient for the burn attestation service and Circle to continue
  // Ethereum delivery without an EVM wallet.
  const receipt: BridgeReceipt = {
    id: transactionId,
    protocol: 'xreserve',
    status: 'SOURCE_CONFIRMING',
    sourceTxId: transactionId,
    protocolState: {
      routeId: call.routeId,
      burnMode: call.mode,
      amountAtomic: call.amountAtomic.toString(),
      nativeDomain: call.nativeDomain,
      nativeRecipientBytes32: call.nativeRecipientBytes32,
      sourceProgram: call.program,
      sourceFunction: call.function,
      forwardingService: 'aleo-burn-attestation',
    },
  }
  await params.onSubmitted?.(receipt)
  return { transactionId, receipt }
}
