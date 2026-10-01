import type { InventoryTarget, RecordAsset } from '@provablehq/veil-core'

/**
 * Defines one asset's maintenance policy in base units.
 * @property asset Native credits, ARC20 or ARC22 program.
 * @property target Desired record count, distribution and minimum in base units.
 * @property countRange Optional inclusive range suppressing reshaping while the minimum holds.
 * @internal
 */
export type InventoryPolicy = {
  asset: RecordAsset
  target: InventoryTarget
  countRange?: [number, number]
}

/**
 * Configures the inventory application without embedding a private key.
 * @property network Aleo testnet or mainnet; defaults to testnet.
 * @property networkUrl HTTP node gateway; defaults to edge.provable.com/api/v2.
 * @property chainId Shared reservation identity; defaults to aleo plus the network name.
 * @property privateKeyEnv Signing-key environment variable; defaults to ALEO_PRIVATE_KEY.
 * @property database Journal filename; defaults to .veil/inventory.sqlite.
 * @property policies Asset policies, empty by default.
 * @property intervalMs Milliseconds between passes; defaults to 30000.
 * @property cooldownMs Milliseconds after an asset operation; defaults to 60000.
 * @property maxTransactions Maximum transitions per pass; defaults to 10.
 * @property maxFeeMicrocredits Transaction/asset-pass network-fee ceiling; defaults to 1000000.
 * @property maxDailyFeeMicrocredits Rolling 24-hour maintenance ceiling; defaults to 10000000.
 * @property useFeeMaster Requests delegated sponsorship; defaults to false.
 * @internal
 */
export type InventoryConfig = {
  network: 'testnet' | 'mainnet'
  networkUrl: string
  chainId: string
  privateKeyEnv: string
  database: string
  policies: InventoryPolicy[]
  intervalMs: number
  cooldownMs: number
  maxTransactions: number
  maxFeeMicrocredits: bigint
  maxDailyFeeMicrocredits: bigint
  useFeeMaster: boolean
}

/**
 * Validates JSON configuration and converts decimal base-unit amounts to bigint.
 * @param value Parsed configuration with amounts encoded as decimal strings.
 * @returns Validated settings; omitted limits use documented bounded defaults.
 * @throws On unknown networks, invalid amounts, duplicate assets or impossible count ranges.
 * @example
 * const config = parseInventoryConfig({ network: 'testnet', policies: [] })
 */
export function parseInventoryConfig(value: unknown): InventoryConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Inventory config must be an object')
  const raw = value as Record<string, unknown>
  const integer = (value: unknown, fallback: number, max: number, zero = false) => {
    const n = value === undefined ? fallback : value
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < (zero ? 0 : 1) || n > max) throw new Error('Invalid inventory count or interval')
    return n
  }
  const amount = (value: unknown, fallback: bigint) => {
    if (value === undefined) return fallback
    if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('Amounts must be non-negative decimal strings in base units')
    return BigInt(value)
  }
  const string = (value: unknown, fallback: string) => {
    if (value === undefined) return fallback
    if (typeof value !== 'string' || !value.trim()) throw new Error('Expected a non-empty configuration string')
    return value
  }
  const network = raw.network ?? 'testnet'
  if (network !== 'testnet' && network !== 'mainnet') throw new Error('Network must be testnet or mainnet')
  if (raw.privateKey !== undefined) throw new Error('Use privateKeyEnv instead of storing a private key in inventory configuration')
  if (raw.useFeeMaster !== undefined && typeof raw.useFeeMaster !== 'boolean') throw new Error('useFeeMaster must be boolean')
  if (!Array.isArray(raw.policies ?? [])) throw new Error('policies must be an array')
  const policies = ((raw.policies ?? []) as Record<string, unknown>[]).map((policy): InventoryPolicy => {
    const asset = policy.asset as RecordAsset
    if (!asset || !/^[a-z][a-z0-9_]*\.aleo$/.test(asset.program) || !['credits', 'arc20', 'arc22'].includes(asset.standard)) throw new Error('Invalid inventory asset')
    if ((asset.standard === 'credits') !== (asset.program === 'credits.aleo')) throw new Error('credits.aleo requires the credits standard')
    const target = policy.target as Record<string, unknown> | undefined
    if (!target) throw new Error('Each policy requires a target')
    const records = integer(target.records, 1, 1000)
    const minRecordAmount = amount(target.minRecordAmount, 1n)
    if (!minRecordAmount) throw new Error('Minimum record amount must be positive')
    const distribution = target.distribution ?? 'preserve'
    if (distribution !== 'preserve' && distribution !== 'balanced') throw new Error('Invalid inventory distribution')
    const range = policy.countRange as number[] | undefined
    if (range && (!Array.isArray(range) || range.length !== 2 || range.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 1000) || range[0]! > records || range[1]! < records)) throw new Error('countRange must contain the target count')
    return { asset: { ...asset }, target: { records, minRecordAmount, distribution,
      toleranceBps: integer(target.toleranceBps, 1000, 10_000, true) }, countRange: range as [number, number] | undefined }
  })
  if (new Set(policies.map((policy) => policy.asset.program)).size !== policies.length) throw new Error('Duplicate inventory asset policy')
  const networkUrl = string(raw.networkUrl, 'https://edge.provable.com/api/v2')
  const url = new URL(networkUrl)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('networkUrl must use HTTP or HTTPS')
  return { network, networkUrl, chainId: string(raw.chainId, `aleo:${network}`),
    privateKeyEnv: string(raw.privateKeyEnv, 'ALEO_PRIVATE_KEY'), database: string(raw.database, '.veil/inventory.sqlite'), policies,
    intervalMs: integer(raw.intervalMs, 30_000, 2_147_483_647), cooldownMs: integer(raw.cooldownMs, 60_000, 2_147_483_647, true),
    maxTransactions: integer(raw.maxTransactions, 10, 1000), maxFeeMicrocredits: amount(raw.maxFeeMicrocredits, 1_000_000n),
    maxDailyFeeMicrocredits: amount(raw.maxDailyFeeMicrocredits, 10_000_000n), useFeeMaster: raw.useFeeMaster === true }
}
