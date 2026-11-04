import type { BridgeChainClients } from '../../connections/resolve.js'
import { BridgeError } from '../../errors/bridgeErrors.js'
import type { BridgePlan, BridgeRegistry } from '../../types/protocol.js'
import type { VerulinkQuote } from '../../types/verulink.js'
import { formatDecimalAmount, parseDecimalAmount } from '../../utils/units.js'
import { checkChain, context, evmRead, fromAleoBytes, integer, mapping, U64_MAX, type Context } from './common.js'

/** Verifies both peer deployments and returns the source fee and transfer limits. */
export async function configuration(c: Context) {
  await checkChain(c)
  const read = (name: string, args: readonly unknown[] = []) => evmRead(c.evm.publicClient, c.evmTokenService, name, args)
  const am = (name: string) => mapping(c.aleo.publicClient, c.aleoTokenService, name, c.chainToken)
  const [self, dest, bridge, token, decimals, peerService, peerToken] = await Promise.all([
    read('self'), read('destChainId'), read('erc20Bridge'), read('supportedTokens', [c.evmToken]),
    evmRead(c.evm.publicClient, c.evmToken, 'decimals'), am('other_chain_token_service'), am('other_chain_token_address'),
  ])
  if (!Array.isArray(self) || self[0] !== BigInt(c.evmDomain) || String(self[1]).toLowerCase() !== c.evmTokenService.toLowerCase()
    || dest !== BigInt(c.aleoDomain) || String(bridge).toLowerCase() !== c.evmBridge.toLowerCase()
    || !Array.isArray(token) || String(token[0]).toLowerCase() !== c.evmToken.toLowerCase()
    || token[2] !== c.aleoTokenId || token[3] !== c.aleoServiceAddress || token[6] !== true || decimals !== 6
    || fromAleoBytes(peerService) !== c.evmTokenService || fromAleoBytes(peerToken) !== c.evmToken) {
    throw new BridgeError('Verulink onchain peers do not match the reviewed deployment')
  }
  if (c.outbound) {
    const [rate, min, max] = await Promise.all([am('platform_fee'), am('min_transfers'), am('max_transfers')])
    return { rate: integer(rate, 'fee rate', 100000n), min: integer(min, 'minimum'), max: integer(max, 'maximum') }
  }
  const collector = await read('feeCollector')
  if (typeof collector !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(collector)) throw new BridgeError('Invalid Verulink fee collector')
  const rate = await evmRead(c.evm.publicClient, collector as `0x${string}`, 'platformFees', [c.evmToken])
  return { rate: integer(rate, 'fee rate', 100000n), min: integer(token[4], 'minimum'), max: integer(token[5], 'maximum') }
}

/** Reads all active flags before a source or destination wallet action; unavailable flags fail closed. */
export async function assertActive(c: Context): Promise<void> {
  const [servicePaused, bridgePaused, tokenPaused, active, supportedChain, supportedService] = await Promise.all([
    evmRead(c.evm.publicClient, c.evmTokenService, 'paused'), evmRead(c.evm.publicClient, c.evmBridge, 'paused'),
    mapping(c.aleo.publicClient, c.aleoTokenService, 'status', c.chainToken),
    mapping(c.aleo.publicClient, c.aleoBridge, 'bridge_settings', '3u8'),
    mapping(c.aleo.publicClient, c.aleoBridge, 'supported_chains', `${c.evmDomain}u128`),
    mapping(c.aleo.publicClient, c.aleoBridge, 'supported_services', c.aleoServiceAddress),
  ])
  if (servicePaused !== false || bridgePaused !== false || tokenPaused !== false || active !== 1n
    || supportedChain !== true || supportedService !== true) throw new BridgeError('Verulink route is paused, unsupported, or unreadable')
}

/** Calculates the current protocol fee from both chains without signing or estimating network fees. */
export async function quote(registry: BridgeRegistry, clients: BridgeChainClients, plan: BridgePlan): Promise<VerulinkQuote> {
  const c = context(registry, clients, plan)
  await assertActive(c)
  const { rate, min, max } = await configuration(c)
  const amountAtomic = parseDecimalAmount(plan.amountIn, 6)
  if (amountAtomic <= 0n || amountAtomic > U64_MAX || (c.outbound && amountAtomic * rate > U64_MAX)) throw new BridgeError('Verulink amount or Aleo fee multiplication exceeds u64')
  const feeAtomic = amountAtomic * rate / 100000n
  const net = amountAtomic - feeAtomic
  if (net <= 0n || net < min) throw new BridgeError(`Verulink net amount is below minimum ${formatDecimalAmount(min, 6)} ALEO`)
  if (net > max) throw new BridgeError(`Verulink net amount exceeds maximum ${formatDecimalAmount(max, 6)} ALEO`)
  const amountOut = formatDecimalAmount(net, 6)
  const fees: VerulinkQuote['fees'] = [
    { kind: 'protocol', chainId: c.sourceChain.id, assetId: c.sourceAsset.id, amount: formatDecimalAmount(feeAtomic, 6), estimated: true },
    { kind: 'network', chainId: c.sourceChain.id, estimated: true },
    { kind: 'network', chainId: c.destinationChain.id, estimated: true },
  ]
  return { kind: c.outbound ? 'aleo-verulink' : 'evm-verulink', protocol: 'verulink', plan: { ...plan, amountOut, fees },
    routeId: c.route.id, amountIn: plan.amountIn, amountOut, amountAtomic, feeAtomic, rate, fees }
}
