export interface PoolState {
  token0: string
  token1: string
  fee: number
  enabled: boolean
}

export interface Slot {
  tick: number
  tick_spacing: number
  sqrt_price: bigint
  fee_protocol: number
  liquidity: bigint
  fee_growth_global0_x_128: bigint
  fee_growth_global1_x_128: bigint
  max_liquidity_per_tick: bigint
  protocol_fees0: bigint
  protocol_fees1: bigint
}

export interface Tick {
  pool: string
  liquidity_net: bigint
  liquidity_gross: bigint
  tick: number
  fee_growth_outside0_128: bigint
  fee_growth_outside1_128: bigint
}

export interface Position {
  token_id: string
  pool: string
  tick_lower: number
  tick_upper: number
  liquidity: bigint
  fee_growth_inside0_last_128: bigint
  fee_growth_inside1_last_128: bigint
  tokens_owed0: bigint
  tokens_owed1: bigint
}

export interface PositionNFT {
  owner: string
  token_id: string
  pool: string
  tick_lower: number
  tick_upper: number
}

export interface PositionNFTRecord extends PositionNFT {
  _nonce: string
  _version?: string
  _ciphertext?: string
}

export interface MintPositionRequest {
  pool: string
  tick_lower: number
  tick_upper: number
  amount0_desired: bigint
  amount1_desired: bigint
  amount0_min: bigint
  amount1_min: bigint
  tick_lower_hint: number
  tick_upper_hint: number
}

export interface SwapRequest {
  pool: string
  zero_for_one: boolean
  amount_in: bigint
  amount_out_min: bigint
  sqrt_price_limit: bigint
  recipient: string
  tick_hint_0: number
  tick_hint_1: number
  nonce: bigint
  deadline: number
}

export interface SwapHop {
  pool: string
  zero_for_one: boolean
  tick_hint_0: number
  tick_hint_1: number
  sqrt_price_limit: bigint
}

export interface SwapMultiHopRequest {
  token_in: string
  token_out: string
  amount_in: bigint
  amount_out_min: bigint
  recipient: string
  hop0: SwapHop
  hop1: SwapHop
  hop2: SwapHop
  hop_count: number
  nonce: bigint
  deadline: number
  caller: string
}

export interface SwapOutput {
  recipient: string
  caller: string
  token_in: string
  token_out: string
  amount_out: bigint
  amount_remaining: bigint
}

export const MIN_TICK = -887272
export const MAX_TICK = 887272

export const FEE_TIERS = {
  LOWEST: 100,
  LOW: 500,
  MEDIUM: 3000,
  HIGH: 10000,
} as const

export const TICK_SPACINGS = {
  ONE: 1,
  TEN: 10,
  SIXTY: 60,
  TWO_HUNDRED: 200,
} as const
