import { readContract, type Client } from '@provablehq/veil-core'
import { resolveTransferRoute } from '../../actions/internal/resolveTransferRoute.js'
import { BridgeError } from '../../errors/bridgeErrors.js'
import type { BridgeRegistry } from '../../types/protocol.js'
import type {
  AleoHyperlanePrivateTransferQuote,
  HyperlanePrivateTransferAmount,
  HyperlanePrivateTransferFees,
  QuoteAleoHyperlanePrivateTransferParameters,
} from '../../types/hyperlanePrivateTransfer.js'
import { formatDecimalAmount } from '../../utils/units.js'
import { buildTransferRemoteCall } from './aleo.js'

const MAX_U128 = (1n << 128n) - 1n
const MAX_U64 = (1n << 64n) - 1n
const ZERO_ADDRESS = `aleo1${'q'.repeat(52)}3ljyzc`
const PROGRAM = /^[a-zA-Z][a-zA-Z0-9_]*\.aleo$/

/**
 * Calculates the included private-transfer token fee using the contract's u128 arithmetic.
 * Computes locally without reading a chain, signing, or moving funds.
 * @param params Supplies a positive gross u128 token amount and a fee rate from 0 through 9999 basis points.
 * @returns Gross spend, rounded-down token fee, and net bridged tokens in local base units.
 * @throws BridgeError When the gross amount or fee rate is outside its contract bounds.
 * @example const amounts = calculateHyperlanePrivateTransferAmount({ amountAtomic: 10000n, feeBps: 25 })
 */
export function calculateHyperlanePrivateTransferAmount(params: { amountAtomic: bigint; feeBps: number }): HyperlanePrivateTransferAmount {
  const { amountAtomic: amount, feeBps } = params
  if (typeof amount !== 'bigint' || amount <= 0n || amount > MAX_U128
    || !Number.isSafeInteger(feeBps) || feeBps < 0 || feeBps >= 10_000) {
    throw new BridgeError('Hyperlane private transfer requires a positive u128 amount and fee rate from 0 through 9999 bps')
  }
  // Splitting the quotient and remainder mirrors the contract without an overflowing u128 product.
  const rate = BigInt(feeBps)
  const fee = (amount / 10_000n) * rate + ((amount % 10_000n) * rate) / 10_000n
  return { grossAmountAtomic: amount, protocolFeeAtomic: fee, netAmountAtomic: amount - fee }
}

/**
 * Reads the current private-transfer fee from an explicitly selected warp mapping.
 * Supports reviewed deployments with different mapping names and boolean keys;
 * only an absent entry defaults to zero. Never contacts wallet-services-api.
 * @param client Supplies Aleo network access for the warp's deployment.
 * @param params Supplies the verified warp program, fee mapping, and boolean key; none are guessed.
 * @returns The current fee rate from 0 through 9999 basis points.
 * @throws BridgeError When lookup metadata or the on-chain u16 rate is invalid. Propagates network failures.
 * @example const feeBps = await readHyperlanePrivateTransferFeeBps(client, { program: 'test_hyp_warp_token_eth_v2.aleo', mapping: 'private_transfer_fee_bps__', key: 'false' })
 */
export async function readHyperlanePrivateTransferFeeBps(
  client: Client,
  params: { program: string; mapping: string; key: 'true' | 'false' },
): Promise<number> {
  if (typeof params.program !== 'string' || !PROGRAM.test(params.program)
    || typeof params.mapping !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(params.mapping)
    || !['true', 'false'].includes(params.key)) throw new BridgeError('Invalid reviewed private transfer fee mapping')
  const literal = await readContract(client, { programId: params.program, mapping: params.mapping, key: params.key })
  if (literal === null) return 0
  if (typeof literal !== 'string' || !/^\d{1,5}u16$/.test(literal.trim()) || Number(literal.trim().slice(0, -3)) >= 10_000) {
    throw new BridgeError('Invalid Hyperlane private transfer fee; expected 0 through 9999 basis points as u16')
  }
  return Number(literal.trim().slice(0, -3))
}

/**
 * Separates gross token funding, dispatch record credits, and Aleo execution fees.
 * Does not add the token fee to the gross record spend or contact a network.
 * @param params Supplies the gross u128 token amount, fee bps, summed dispatch hook payments in u64 microcredits, and optional u64 execution fee. The execution fee defaults to unknown (null).
 * @returns Independent token and credits funding requirements; total credits remain null until execution fees are known.
 * @throws BridgeError When token, rate, or credits values exceed their contract bounds.
 * @example const fees = planHyperlanePrivateTransferFees({ amountAtomic: 10000n, feeBps: 25, dispatchCreditsMicrocredits: 100n })
 */
export function planHyperlanePrivateTransferFees(params: {
  amountAtomic: bigint
  feeBps: number
  dispatchCreditsMicrocredits: bigint
  executionFeeMicrocredits?: bigint | null | undefined
}): HyperlanePrivateTransferFees {
  const execution = params.executionFeeMicrocredits ?? null
  for (const value of [params.dispatchCreditsMicrocredits, ...(execution === null ? [] : [execution])]) {
    if (typeof value !== 'bigint' || value < 0n || value > MAX_U64) throw new BridgeError('Hyperlane credits requirement must fit a nonnegative u64')
  }
  return { ...calculateHyperlanePrivateTransferAmount(params), feeBps: params.feeBps,
    tokenRecordAmountAtomic: params.amountAtomic, dispatchCreditsRecordMicrocredits: params.dispatchCreditsMicrocredits,
    executionFeeMicrocredits: execution, totalMicrocredits: execution === null ? null : params.dispatchCreditsMicrocredits + execution,
  }
}

/** Reads a bounded unsigned integer literal without accepting a different Aleo width. */
function uint(value: unknown, width: 8 | 128, label: string): bigint {
  if (typeof value !== 'string' || !new RegExp(`^\\d+u${width}$`).test(value.trim())) throw new BridgeError(`Invalid Hyperlane ${label}`)
  const result = BigInt(value.trim().slice(0, -String(width).length - 1))
  if (result >= 1n << BigInt(width)) throw new BridgeError(`Hyperlane ${label} exceeds u${width}`)
  return result
}

/**
 * Quotes included token fees and both hook payments for a reviewed private outbound transfer.
 * Reads Aleo fee and hook state without requesting a signature. This accounting
 * helper does not enable private execution or alter existing public quotes.
 * @param registry Supplies pinned outbound ABI, fee mapping, router, and hook metadata.
 * @param client Supplies Aleo network access; wallet-services-api is not used.
 * @param params Supplies the original plan whose amount is the gross token record spend.
 * @returns Net destination tokens and separate token, dispatch credits, and unknown execution fee requirements.
 * @throws BridgeError When deployment metadata, recipient, amount, fee state, hook types, arithmetic bounds, or decimal conversion is invalid.
 * @example const quote = await quoteAleoHyperlanePrivateTransfer(registry, client, { plan })
 */
export async function quoteAleoHyperlanePrivateTransfer(
  registry: BridgeRegistry,
  client: Client,
  params: QuoteAleoHyperlanePrivateTransferParameters,
): Promise<AleoHyperlanePrivateTransferQuote> {
  const resolved = resolveTransferRoute(registry, params.plan)
  const { route, sourceAsset, destinationAsset, sourceChain, destinationChain } = resolved
  const m = route.metadata
  if (route.protocol !== 'hyperlane' || route.availability !== 'active' || sourceChain.family !== 'aleo'
    || !['evm', 'solana'].includes(destinationChain.family) || m?.aleoPrivateTransferAbi !== 'transfer_remote_private_v1'
    || typeof m.aleoPrivateTransferCommit !== 'string' || !/^[0-9a-f]{40}$/.test(m.aleoPrivateTransferCommit)
    || typeof m.aleoPrivateTransferFeeMapping !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(m.aleoPrivateTransferFeeMapping)
    || (m.aleoPrivateTransferFeeKey !== 'true' && m.aleoPrivateTransferFeeKey !== 'false')) {
    throw new BridgeError('Hyperlane private transfer quote requires reviewed ABI and fee mapping metadata')
  }
  const local = m.aleoLocalDecimals ?? sourceAsset.decimals
  const remote = m.aleoRemoteDecimals ?? destinationAsset.decimals
  if (typeof local !== 'number' || !Number.isSafeInteger(local) || local < 0 || local > 255
    || typeof remote !== 'number' || !Number.isSafeInteger(remote) || remote < 0 || remote > 255
    || local !== sourceAsset.decimals || remote !== destinationAsset.decimals || Math.abs(remote - local) > 18) {
    throw new BridgeError('Private transfer decimals do not match the reviewed assets or exceed the supported difference of 18')
  }
  // Canonical registry assets prevent saved decimal fields from changing token amounts.
  const call = buildTransferRemoteCall(registry, { plan: { ...params.plan, sourceAsset, destinationAsset }, gasPaymentMicrocredits: 1n })
  if (call.usesPlaceholderConfiguration) throw new BridgeError('Private transfer fees cannot be quoted from placeholder route metadata')
  // Validate the gross amount before the first live fee read.
  calculateHyperlanePrivateTransferAmount({ amountAtomic: call.amountAtomic, feeBps: 0 })
  const program = call.program
  const hookManager = m.aleoHookManagerProgram
  const defaultHook = m.aleoMailboxDefaultHook
  const requiredHook = m.aleoMailboxRequiredHook
  const customHook = m.aleoHook
  const destination = m.aleoDestinationDomain
  const gasLiteral = m.aleoRemoteRouterGas
  if (typeof hookManager !== 'string' || !PROGRAM.test(hookManager)
    || ![defaultHook, requiredHook, customHook].every(value => typeof value === 'string' && /^aleo1[a-z0-9]{58}$/.test(value))
    || defaultHook === ZERO_ADDRESS || requiredHook === ZERO_ADDRESS
    || typeof destination !== 'number' || !Number.isSafeInteger(destination) || destination < 0 || destination > 0xffff_ffff
    || typeof gasLiteral !== 'string' || !/^\d+$/.test(gasLiteral) || BigInt(gasLiteral) > MAX_U128) {
    throw new BridgeError('Invalid reviewed private dispatch hook configuration')
  }
  const hooks = [customHook === ZERO_ADDRESS ? defaultHook : customHook, requiredHook] as string[]
  const gasLimit = BigInt(gasLiteral) || 50_000n
  const feeBps = await readHyperlanePrivateTransferFeeBps(client, { program, mapping: m.aleoPrivateTransferFeeMapping, key: m.aleoPrivateTransferFeeKey })
  const amounts = calculateHyperlanePrivateTransferAmount({ amountAtomic: call.amountAtomic, feeBps })
  const destinationAmountAtomic = remote >= local
    ? amounts.netAmountAtomic * 10n ** BigInt(remote - local)
    : amounts.netAmountAtomic / 10n ** BigInt(local - remote)
  if (destinationAmountAtomic <= 0n || destinationAmountAtomic >= 1n << 256n) throw new BridgeError('Net private transfer amount does not fit positive destination units')
  const payments = new Map<string, bigint>()
  for (const hook of new Set(hooks)) {
    const hookType = uint(await readContract(client, { programId: hookManager, mapping: 'hooks', key: hook }), 8, 'hook type')
    if (hookType === 0n || hookType === 3n) { payments.set(hook, 0n); continue }
    if (hookType !== 4n) throw new BridgeError('Unsupported Hyperlane private dispatch hook type')
    const literal = await readContract(client, { programId: hookManager, mapping: 'destination_gas_configs', key: `{ igp: ${hook}, destination: ${destination}u32 }` })
    if (literal === null) throw new BridgeError('Missing Hyperlane private dispatch gas configuration')
    if (typeof literal !== 'string' || !/^\s*\{[\s\S]*\}\s*$/.test(literal)) throw new BridgeError('Invalid private dispatch gas configuration')
    const get = (key: string): bigint => {
      const matches = [...literal.matchAll(new RegExp(`\\b${key}\\s*:\\s*([^,}]+)`, 'g'))]
      if (matches.length !== 1) throw new BridgeError(`Invalid private dispatch gas ${key}`)
      return uint(matches[0]![1], 128, `gas ${key}`)
    }
    // Each intermediate is a u128 in the hook contract, before the final u64 payment.
    const totalGas = gasLimit + get('gas_overhead')
    const priced = totalGas * get('gas_price')
    const converted = priced * get('exchange_rate')
    if (totalGas > MAX_U128 || priced > MAX_U128 || converted > MAX_U128) throw new BridgeError('Private dispatch gas calculation overflows u128')
    const payment = converted / 10_000_000_000n
    if (payment > MAX_U64) throw new BridgeError('Private dispatch hook payment overflows u64')
    payments.set(hook, payment)
  }
  // Both invocations charge, including when the effective and required hooks are identical.
  const hookPayments = hooks.map(hook => ({ hook, paymentMicrocredits: payments.get(hook)! }))
  const dispatchCreditsMicrocredits = hookPayments.reduce((sum, payment) => sum + payment.paymentMicrocredits, 0n)
  return { ...planHyperlanePrivateTransferFees({ amountAtomic: call.amountAtomic, feeBps, dispatchCreditsMicrocredits }),
    routeId: route.id, program, amountIn: params.plan.amountIn,
    amountOut: formatDecimalAmount(destinationAmountAtomic, remote), destinationAmountAtomic, hookPayments,
  }
}
