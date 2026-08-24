import type { TransactionInput } from '@provablehq/veil-core'
import { BridgeError } from '../errors/bridgeErrors.js'
import type {
  AleoBridgeExecutor,
  ExecuteXReserveBurnParameters,
  XReserveBurnCall,
  XReserveBurnExecution,
} from '../types/aleo.js'
import type { BridgeRegistry } from '../types/protocol.js'
import { parseDecimalAmount } from '../utils/units.js'
import { evmAddressToXReserveBytes32, xReserveHexToAleoBytes } from '../utils/xreserve.js'

const ETHEREUM_DESTINATION_DOMAIN = 0

function validatedRoute(registry: BridgeRegistry, params: ExecuteXReserveBurnParameters) {
  const { plan } = params
  if (plan.protocol !== 'xreserve' || plan.route.protocol !== 'xreserve') throw new BridgeError('USDCx burn requires an xReserve transfer plan')
  if (plan.registryVersion !== registry.version) throw new BridgeError(`Transfer plan uses registry ${plan.registryVersion}; expected ${registry.version}`)
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
  if (typeof bridgeProgram !== 'string' || !bridgeProgram.endsWith('.aleo')) throw new BridgeError(`xReserve bridge program is invalid: ${route.id}`)
  if (typeof wrapperProgram !== 'string' || !wrapperProgram.endsWith('.aleo')) throw new BridgeError(`xReserve wrapper program is invalid: ${route.id}`)
  if (typeof tokenProgram !== 'string' || !tokenProgram.endsWith('.aleo')) throw new BridgeError(`xReserve token program is invalid: ${route.id}`)
  if (nativeDomain !== ETHEREUM_DESTINATION_DOMAIN) throw new BridgeError(`xReserve Ethereum destination domain must be ${ETHEREUM_DESTINATION_DOMAIN}: ${route.id}`)
  return { route, bridgeProgram, wrapperProgram, tokenProgram, nativeDomain }
}

function assertPrivateInputs(userRecord: TransactionInput | undefined, merkleProof: string | undefined, tokenProgram: string): asserts userRecord is TransactionInput {
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
 * Builds one validated Aleo USDCx burn call without prompting a wallet.
 *
 * Pure and local: fixes Ethereum's Circle domain to `0u32`, encodes the EVM
 * recipient as `[u8; 32]`, and selects the bridge or wrapper transition. Dynamic
 * pause, freeze-list, and burn-limit checks remain atomic on-chain assertions.
 *
 * @param registry Reviewed route snapshot supplying the deployed Aleo programs and domain.
 * @param params Prepared reverse route, burn mode, and private inputs when applicable.
 * @returns Exact program, function, and ordered wallet inputs for the burn.
 * @throws BridgeError When the route, amount, recipient, mode-specific inputs, or metadata is invalid.
 *
 * @example
 * const call = buildXReserveBurnCall(registry, { plan, mode: 'public-as-signer' })
 */
export function buildXReserveBurnCall(
  registry: BridgeRegistry,
  params: ExecuteXReserveBurnParameters,
): XReserveBurnCall {
  const deployment = validatedRoute(registry, params)
  const mode = params.mode ?? 'private'
  if (mode !== 'public-as-signer' && mode !== 'public' && mode !== 'private') throw new BridgeError(`Unsupported USDCx burn mode: ${String(mode)}`)
  const amountAtomic = parseDecimalAmount(params.plan.amountIn, params.plan.sourceAsset.decimals)
  if (amountAtomic <= 0n) throw new BridgeError('USDCx burn amount must be greater than zero')
  const nativeRecipientBytes32 = evmAddressToXReserveBytes32(params.plan.recipient)
  const amount = `${amountAtomic}u128`
  const nativeDomain = `${deployment.nativeDomain}u32`
  const nativeRecipient = xReserveHexToAleoBytes(nativeRecipientBytes32, 32)

  if (mode === 'private') {
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
 * Prompts an Aleo wallet to submit a public, signer-bound, or private USDCx burn.
 *
 * The action returns after broadcast. The Aleo-operated burn attestation service
 * observes accepted burns and forwards them to Circle without another client call.
 *
 * @param registry Reviewed route snapshot used to validate program and domain identifiers.
 * @param executor Connected Aleo wallet client that proves, signs, and broadcasts.
 * @param params Prepared reverse route, selected mode, optional record/proof, and fee privacy.
 * @returns The Aleo transaction id and resumable source-confirming receipt.
 * @throws BridgeError When call construction fails or the wallet returns no transaction id.
 *
 * @example
 * const burn = await executeXReserveBurn(registry, aleoWalletClient, {
 *   plan,
 *   userRecord,
 *   merkleProof,
 * })
 */
export async function executeXReserveBurn(
  registry: BridgeRegistry,
  executor: AleoBridgeExecutor,
  params: ExecuteXReserveBurnParameters,
): Promise<XReserveBurnExecution> {
  const call = buildXReserveBurnCall(registry, params)
  const result = await executor.executeTransaction({
    program: call.program,
    function: call.function,
    inputs: call.inputs,
    privateFee: params.privateFee ?? false,
  })
  const transactionId = typeof result === 'string' ? result : result.transactionId
  if (!transactionId) throw new BridgeError('Aleo wallet returned an empty burn transaction id')
  return {
    transactionId,
    receipt: {
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
    },
  }
}
