import type { PublicClient } from '@veil/core'
import type {
  PoolState,
  Slot,
  Tick,
  Position,
  PositionNFT,
  PositionNFTRecord,
  MintPositionRequest,
  SwapRequest,
  SwapHop,
  SwapMultiHopRequest,
  SwapOutput,
} from '../types/index.js'
import {
  toField, toU128, toU64, toU32, toU16, toU8, toI32, toBool, toAddress,
  fromField, fromU128, fromU32, fromU16, fromU8, fromI32, fromBool,
  parseStruct,
} from '../utils/formatting.js'

export const AMM_PROGRAM_ID = 'leo_amm.aleo'

export class AmmClient {
  private publicClient: PublicClient
  readonly programId: string

  constructor(publicClient: PublicClient, programId = AMM_PROGRAM_ID) {
    this.publicClient = publicClient
    this.programId = programId
  }

  // ── State queries ──────────────────────────────────────────────────────

  async getPool(poolKey: string): Promise<PoolState | null> {
    const raw = await this.read('pools', toField(poolKey))
    return raw ? this.parsePoolState(raw) : null
  }

  async getSlot(poolKey: string): Promise<Slot | null> {
    const raw = await this.read('slots', toField(poolKey))
    return raw ? this.parseSlot(raw) : null
  }

  async getTick(tickKey: string): Promise<Tick | null> {
    const raw = await this.read('ticks', toField(tickKey))
    return raw ? this.parseTick(raw) : null
  }

  async getPosition(tokenId: string): Promise<Position | null> {
    const raw = await this.read('positions', toField(tokenId))
    return raw ? this.parsePosition(raw) : null
  }

  async getSwapOutput(swapId: string): Promise<SwapOutput | null> {
    const raw = await this.read('swap_outputs', toField(swapId))
    return raw ? this.parseSwapOutput(raw) : null
  }

  async isPoolInitialized(poolKey: string): Promise<boolean> {
    return (await this.read('initialized_pools', toField(poolKey))) === 'true'
  }

  async isFeeTierValid(fee: number): Promise<boolean> {
    return (await this.read('fee_tiers', toU16(fee))) === 'true'
  }

  async isTickSpacingValid(spacing: number): Promise<boolean> {
    return (await this.read('tick_spacings', toU32(spacing))) === 'true'
  }

  async getAdmin(): Promise<string | null> {
    return this.read('admin', 'true')
  }

  // ── Input formatters ───────────────────────────────────────────────────

  formatCreatePoolInputs(
    token0: string,
    token1: string,
    fee: number,
    initialSqrtPrice: bigint,
    tickSpacing: number,
    initialTick: number,
  ): string[] {
    return [
      toField(token0),
      toField(token1),
      toU16(fee),
      toU128(initialSqrtPrice),
      toU32(tickSpacing),
      toI32(initialTick),
    ]
  }

  formatMintRequest(req: MintPositionRequest): Record<string, string> {
    return {
      pool:             toField(req.pool),
      tick_lower:       toI32(req.tick_lower),
      tick_upper:       toI32(req.tick_upper),
      amount0_desired:  toU128(req.amount0_desired),
      amount1_desired:  toU128(req.amount1_desired),
      amount0_min:      toU128(req.amount0_min),
      amount1_min:      toU128(req.amount1_min),
      tick_lower_hint:  toI32(req.tick_lower_hint),
      tick_upper_hint:  toI32(req.tick_upper_hint),
    }
  }

  formatMintInputs(
    recipient: string,
    req: MintPositionRequest,
    token0Id: string,
    token1Id: string,
  ): string[] {
    const struct = this.structStr(this.formatMintRequest(req))
    return [toAddress(recipient), struct, toField(token0Id), toField(token1Id)]
  }

  formatSwapRequest(req: SwapRequest): Record<string, string> {
    return {
      pool:              toField(req.pool),
      zero_for_one:      toBool(req.zero_for_one),
      amount_in:         toU128(req.amount_in),
      amount_out_min:    toU128(req.amount_out_min),
      sqrt_price_limit:  toU128(req.sqrt_price_limit),
      recipient:         toAddress(req.recipient),
      tick_hint_0:       toI32(req.tick_hint_0),
      tick_hint_1:       toI32(req.tick_hint_1),
      nonce:             toU64(req.nonce),
      deadline:          toU32(req.deadline),
    }
  }

  formatSwapInputs(req: SwapRequest, token0Id: string, token1Id: string): string[] {
    return [this.structStr(this.formatSwapRequest(req)), toField(token0Id), toField(token1Id)]
  }

  formatClaimSwapOutputInputs(
    swapId: string,
    tokenIn: string,
    tokenOut: string,
    amountOut: bigint,
    amountRemaining: bigint,
    recipient: string,
  ): string[] {
    return [
      toField(swapId),
      toField(tokenIn),
      toField(tokenOut),
      toU128(amountOut),
      toU128(amountRemaining),
      toAddress(recipient),
    ]
  }

  formatSwapMultiHopInputs(req: SwapMultiHopRequest): string[] {
    const hop = (h: SwapHop) =>
      `{ pool: ${toField(h.pool)}, zero_for_one: ${toBool(h.zero_for_one)}, tick_hint_0: ${toI32(h.tick_hint_0)}, tick_hint_1: ${toI32(h.tick_hint_1)}, sqrt_price_limit: ${toU128(h.sqrt_price_limit)} }`

    const struct = `{ token_in: ${toField(req.token_in)}, token_out: ${toField(req.token_out)}, amount_in: ${toU128(req.amount_in)}, amount_out_min: ${toU128(req.amount_out_min)}, recipient: ${toAddress(req.recipient)}, hop0: ${hop(req.hop0)}, hop1: ${hop(req.hop1)}, hop2: ${hop(req.hop2)}, hop_count: ${toU8(req.hop_count)}, nonce: ${toU64(req.nonce)}, deadline: ${toU32(req.deadline)}, caller: ${toAddress(req.caller)} }`
    return [struct]
  }

  formatPositionNFTForCLI(nft: PositionNFT): string {
    return `{ owner: ${toAddress(nft.owner)}, token_id: ${toField(nft.token_id)}, pool: ${toField(nft.pool)}, tick_lower: ${toI32(nft.tick_lower)}, tick_upper: ${toI32(nft.tick_upper)} }`
  }

  formatPositionNFTRecordForCLI(nft: PositionNFTRecord): string {
    const strip = (v: string) => v.replace(/\.(private|public)$/, '')
    const owner    = `${strip(toAddress(nft.owner))}.private`
    const tokenId  = `${toField(nft.token_id)}.private`
    const pool     = `${toField(nft.pool)}.private`
    const tickLow  = `${toI32(nft.tick_lower)}.private`
    const tickUp   = `${toI32(nft.tick_upper)}.private`
    const nonce    = `${strip(nft._nonce)}.public`
    const versionBase = nft._version ? strip(nft._version) : '1u8'
    const version  = `${versionBase.endsWith('u8') ? versionBase : `${versionBase}u8`}.public`
    return `{ owner: ${owner}, token_id: ${tokenId}, pool: ${pool}, tick_lower: ${tickLow}, tick_upper: ${tickUp}, _nonce: ${nonce}, _version: ${version} }`
  }

  parsePositionNFTRecord(value: string): PositionNFTRecord | null {
    try {
      const p = parseStruct(value)
      if (!p.owner || !p.token_id || !p.pool || !p._nonce) return null
      const strip = (v: string) => v.replace(/\.(private|public)$/, '')
      return {
        owner:      strip(p.owner),
        token_id:   strip(p.token_id),
        pool:       strip(p.pool),
        tick_lower: fromI32(strip(p.tick_lower ?? '')),
        tick_upper: fromI32(strip(p.tick_upper ?? '')),
        _nonce:     p._nonce!,
        _version:   p._version,
      }
    } catch {
      return null
    }
  }

  generateNonce(): bigint {
    return BigInt(Date.now()) * BigInt(1_000_000) + BigInt(Math.floor(Math.random() * 1_000_000))
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private async read(mapping: string, key: string): Promise<string | null> {
    try {
      return await this.publicClient.readContract({ programId: this.programId, mapping, key })
    } catch {
      return null
    }
  }

  private structStr(fields: Record<string, string>): string {
    return `{ ${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join(', ')} }`
  }

  private parsePoolState(raw: string): PoolState {
    const p = parseStruct(raw)
    return {
      token0:   fromField(p.token0!),
      token1:   fromField(p.token1!),
      fee:      fromU16(p.fee!),
      enabled:  fromBool(p.enabled!),
    }
  }

  private parseSlot(raw: string): Slot {
    const p = parseStruct(raw)
    return {
      tick:                       fromI32(p.tick!),
      tick_spacing:               fromU32(p.tick_spacing!),
      sqrt_price:                 fromU128(p.sqrt_price!),
      fee_protocol:               fromU8(p.fee_protocol!),
      liquidity:                  fromU128(p.liquidity!),
      fee_growth_global0_x_128:   fromU128(p.fee_growth_global0_x_128!),
      fee_growth_global1_x_128:   fromU128(p.fee_growth_global1_x_128!),
      max_liquidity_per_tick:     fromU128(p.max_liquidity_per_tick!),
      protocol_fees0:             fromU128(p.protocol_fees0!),
      protocol_fees1:             fromU128(p.protocol_fees1!),
    }
  }

  private parseTick(raw: string): Tick {
    const p = parseStruct(raw)
    return {
      pool:                     fromField(p.pool!),
      liquidity_net:            BigInt(p.liquidity_net!.replace(/i128$/, '')),
      liquidity_gross:          fromU128(p.liquidity_gross!),
      tick:                     fromI32(p.tick!),
      fee_growth_outside0_128:  fromU128(p.fee_growth_outside0_128!),
      fee_growth_outside1_128:  fromU128(p.fee_growth_outside1_128!),
    }
  }

  private parsePosition(raw: string): Position {
    const p = parseStruct(raw)
    return {
      token_id:                   fromField(p.token_id!),
      pool:                       fromField(p.pool!),
      tick_lower:                 fromI32(p.tick_lower!),
      tick_upper:                 fromI32(p.tick_upper!),
      liquidity:                  fromU128(p.liquidity!),
      fee_growth_inside0_last_128: fromU128(p.fee_growth_inside0_last_128!),
      fee_growth_inside1_last_128: fromU128(p.fee_growth_inside1_last_128!),
      tokens_owed0:               fromU128(p.tokens_owed0!),
      tokens_owed1:               fromU128(p.tokens_owed1!),
    }
  }

  private parseSwapOutput(raw: string): SwapOutput {
    const p = parseStruct(raw)
    return {
      recipient:        p.recipient!,
      caller:           p.caller!,
      token_in:         fromField(p.token_in!),
      token_out:        fromField(p.token_out!),
      amount_out:       fromU128(p.amount_out!),
      amount_remaining: fromU128(p.amount_remaining!),
    }
  }
}
