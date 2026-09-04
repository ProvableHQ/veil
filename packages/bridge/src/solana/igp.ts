import { BridgeError } from '../errors/bridgeErrors.js'

// SEALEVEL_NOTES.md §4: fixed-point scale for `token_exchange_rate` — a rate
// of 1.0 is stored on-chain as 10^19.
const TOKEN_EXCHANGE_RATE_SCALE = 10n ** 19n

// SEALEVEL_NOTES.md §4: SOL's native decimal width, used to rescale the
// oracle's origin-chain-denominated cost into lamports.
const SOL_DECIMALS = 9

// SEALEVEL_NOTES.md §4: fixed byte offsets preceding the gas-oracle table —
// `AccountData<DiscriminatorPrefixed<Igp>>`'s `[1B initialized][8B "IGP_____"
// discriminator][1B bump_seed][32B salt]` header, followed by `Igp`'s own
// `[1B owner Option tag (+32B when Some)][32B beneficiary][4B oracle count]`.
const INITIALIZED_BYTES = 1
const DISCRIMINATOR_BYTES = 8
const BUMP_SEED_BYTES = 1
const SALT_BYTES = 32
const PUBKEY_BYTES = 32
const ORACLE_COUNT_BYTES = 4

// SEALEVEL_NOTES.md §4: one `gas_oracles` entry — `GAS_ORACLE_ENTRY_SIZE`
// (accounts.rs) — `[4B domain][1B GasOracle tag][16B token_exchange_rate]
// [16B gas_price][1B token_decimals]`.
const GAS_ORACLE_ENTRY_BYTES = 38
const DOMAIN_BYTES = 4
const GAS_ORACLE_TAG_BYTES = 1
const EXCHANGE_RATE_BYTES = 16
const GAS_PRICE_BYTES = 16

function readUint128LE(view: DataView, offset: number): bigint {
  let value = 0n
  for (let index = EXCHANGE_RATE_BYTES - 1; index >= 0; index--) {
    value = (value << 8n) | BigInt(view.getUint8(offset + index))
  }
  return value
}

/**
 * Computes the lamport gas payment a Sealevel interchain gas paymaster (IGP)
 * quotes for delivering a message to a given destination domain.
 *
 * Pure and local: decodes the IGP account's own gas-oracle table and applies
 * the paymaster's `compute_gas_fee` formula (SEALEVEL_NOTES.md §4) without
 * touching the network. `igpAccountData` must be the terminal, quoted `Igp`
 * account — the one an `OverheadIgp` wrapper's own `inner` field points at,
 * not the `OverheadIgp` wrapper account itself — and `gasAmount` must be the
 * warp token's own `destination_gas` value for the domain, not derived from
 * the message.
 *
 * @param params.igpAccountData Raw account data of the terminal Sealevel `Igp` account.
 * @param params.destinationDomain Hyperlane domain the transfer is bound for.
 * @param params.gasAmount Destination gas units to quote, as reported by the warp token's `destination_gas` configuration.
 * @returns The gas payment required, in lamports.
 * @throws BridgeError When `igpAccountData` has no gas-oracle entry for `destinationDomain`.
 *
 * @example
 * const lamports = quoteIgpGasPayment({
 *   igpAccountData: await rpc.getAccountData(route.igpAccount) ?? new Uint8Array(),
 *   destinationDomain: route.destinationDomain,
 *   gasAmount: BigInt(route.destinationGasAmount),
 * })
 */
export function quoteIgpGasPayment(params: {
  igpAccountData: Uint8Array
  destinationDomain: number
  gasAmount: bigint
}): bigint {
  const { igpAccountData } = params
  const view = new DataView(igpAccountData.buffer, igpAccountData.byteOffset, igpAccountData.byteLength)

  let offset = INITIALIZED_BYTES + DISCRIMINATOR_BYTES + BUMP_SEED_BYTES + SALT_BYTES
  const ownerOptionTag = view.getUint8(offset)
  offset += 1
  if (ownerOptionTag !== 0) offset += PUBKEY_BYTES // owner: Option<Pubkey>, present
  offset += PUBKEY_BYTES // beneficiary

  const oracleCount = view.getUint32(offset, true)
  offset += ORACLE_COUNT_BYTES

  for (let index = 0; index < oracleCount; index++) {
    const entryStart = offset
    const domain = view.getUint32(entryStart, true)
    if (domain === params.destinationDomain) {
      // SEALEVEL_NOTES.md §4: `RemoteGasData` (tag 0) is the only `GasOracle`
      // variant defined today. Assert it rather than silently decoding a
      // future variant's bytes as if they were `RemoteGasData`'s.
      const tagOffset = entryStart + DOMAIN_BYTES
      const gasOracleTag = view.getUint8(tagOffset)
      if (gasOracleTag !== 0) {
        throw new BridgeError(
          `Sealevel IGP account has an unexpected GasOracle variant tag ${gasOracleTag} for domain `
          + `${params.destinationDomain}; only variant 0 (RemoteGasData) is decoded`,
        )
      }

      const exchangeRateOffset = tagOffset + GAS_ORACLE_TAG_BYTES
      const gasPriceOffset = exchangeRateOffset + EXCHANGE_RATE_BYTES
      const decimalsOffset = gasPriceOffset + GAS_PRICE_BYTES

      const tokenExchangeRate = readUint128LE(view, exchangeRateOffset)
      const gasPrice = readUint128LE(view, gasPriceOffset)
      const tokenDecimals = view.getUint8(decimalsOffset)

      // SEALEVEL_NOTES.md §4 `compute_gas_fee` / `convert_decimals`.
      const destinationCost = params.gasAmount * gasPrice
      const originCost = (destinationCost * tokenExchangeRate) / TOKEN_EXCHANGE_RATE_SCALE
      return SOL_DECIMALS >= tokenDecimals
        ? originCost * 10n ** BigInt(SOL_DECIMALS - tokenDecimals)
        : originCost / 10n ** BigInt(tokenDecimals - SOL_DECIMALS)
    }
    offset += GAS_ORACLE_ENTRY_BYTES
  }

  throw new BridgeError(
    `Sealevel IGP account has no gas-oracle entry for destination domain ${params.destinationDomain}`,
  )
}
