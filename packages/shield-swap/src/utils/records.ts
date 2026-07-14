import { requestRecords, parseRecordPlaintextLoose, type Client, type InputRequest, type OwnedRecord } from '@provablehq/veil-core'

/**
 * A token record's decoded essentials, alongside the record it came from.
 *
 * @property amount Raw atomic token amount (u128).
 * @property tokenId The registry `token_id` field literal, or `undefined` for
 *   wrapper-program records (their program IS the token, so they carry none).
 * @property record The owning record — pass its `recordPlaintext` as the
 *   transition's record input.
 */
export interface TokenRecordInfo {
  amount: bigint
  tokenId?: string
  record: OwnedRecord
}

/**
 * Decodes a token record's amount (and registry token id when present).
 *
 * Handles both shapes in the wild: token_registry records
 * (`owner`, `amount`, `token_id`, …) and ARC-20 wrapper-program records
 * (`owner`, `amount`, `_nonce` only). Pure and local.
 *
 * @param plaintext The record plaintext (`{ owner: …, amount: …u128, … }`).
 * @returns The decoded amount/token id, or `null` when the plaintext has no
 *   parseable `amount` — i.e. it is not a token record.
 *
 * @example
 * parseTokenRecordInfo('{ owner: aleo1…, amount: 5000u128.private, _nonce: 1group.public }')
 * // → { amount: 5000n }
 */
export function parseTokenRecordInfo(plaintext: string): { amount: bigint; tokenId?: string } | null {
  let value
  try {
    value = parseRecordPlaintextLoose(plaintext)
  } catch {
    return null
  }
  const amountRaw = value.fields.amount?.value
  if (typeof amountRaw !== 'bigint') return null
  const tokenIdRaw = value.fields.token_id?.value
  const tokenId =
    typeof tokenIdRaw === 'bigint' ? `${tokenIdRaw}field` : typeof tokenIdRaw === 'string' ? tokenIdRaw : undefined
  return { amount: amountRaw, tokenId }
}

/**
 * Parameters for {@link selectTokenRecord}.
 *
 * @property program The program holding the token records — a wrapper
 *   program (e.g. `ethx_5a095e.aleo`) or the token registry. Look it up via
 *   the API's token metadata (`wrapper_program`).
 * @property minAmount Smallest acceptable record amount (u128). The swap
 *   consumes the record whole and refunds change, so any record ≥ the trade
 *   amount works.
 * @property tokenId Registry `token_id` to match. Required when `program` is
 *   a multi-token registry; ignored for wrapper records (which carry none).
 */
export type SelectTokenRecordParameters = {
  program: string
  minAmount: bigint
  tokenId?: string
}

/**
 * Selects an unspent token record covering an amount.
 *
 * Local-signer path only: wallet signers select records wallet-side via
 * `record` InputRequests with filters. Requests the account's unspent records
 * for the program and returns the SMALLEST sufficient one, which limits
 * change fragmentation over time.
 *
 * Hits the network (or the wallet's scanner): one `requestRecords` call.
 * Requires the client to have a record provider (local accounts).
 *
 * @param client A Veil wallet client with a record provider.
 * @param params Program, minimum amount, and optional registry token id.
 * @returns The selected record with its decoded amount.
 * @throws When no unspent record of the program covers `minAmount` — the
 *   caller holds too little, or holds it publicly rather than in records.
 *
 * @example
 * const { record } = await selectTokenRecord(client, { program: 'ethx_5a095e.aleo', minAmount: 10n ** 18n })
 */
export async function selectTokenRecord(client: Client, params: SelectTokenRecordParameters): Promise<TokenRecordInfo> {
  const records = (await requestRecords(client, {
    program: params.program,
    statusFilter: 'unspent',
  })) as OwnedRecord[]

  let best: TokenRecordInfo | undefined
  for (const record of records) {
    if (!record.recordPlaintext) continue
    const info = parseTokenRecordInfo(record.recordPlaintext)
    if (!info) continue
    if (params.tokenId !== undefined && info.tokenId !== undefined && info.tokenId !== params.tokenId) continue
    if (info.amount < params.minAmount) continue
    if (!best || info.amount < best.amount) best = { ...info, record }
  }

  if (!best) {
    throw new Error(
      `No unspent ${params.program} record covers ${params.minAmount}` +
        (params.tokenId ? ` for token ${params.tokenId}` : '') +
        ' — balance too low, or funds are public rather than in records.',
    )
  }
  return best
}

/**
 * Parameters for {@link selectPositionNFT}.
 *
 * @property program The shield_swap program owning the PositionNFT records.
 * @property poolKey Pool whose position to select.
 * @property tokenId Select one specific position by its `token_id` field
 *   literal. Optional — without it, the first unspent position for the pool
 *   is returned.
 */
export type SelectPositionNFTParameters = {
  program: string
  poolKey: string
  tokenId?: string
}

/**
 * A PositionNFT record's decoded essentials.
 *
 * @property tokenId The position's `token_id` field literal.
 * @property tickLower Lower bound tick of the position's range.
 * @property tickUpper Upper bound tick of the position's range.
 * @property record The owning record — pass its `recordPlaintext` as
 *   `increase_liquidity`'s first input.
 */
export interface PositionNFTInfo {
  tokenId: string
  tickLower: number
  tickUpper: number
  record: OwnedRecord
}

/**
 * Selects an unspent PositionNFT record for a pool.
 *
 * Local-signer path only (wallet signers pass a `record` InputRequest).
 * PositionNFTs live in the shield_swap program itself — one record per
 * minted position, consumed and re-issued by every liquidity change.
 *
 * Hits the network (or the wallet's scanner): one `requestRecords` call.
 *
 * @param client A Veil wallet client with a record provider.
 * @param params Program, pool, and optionally a specific position token id.
 * @returns The position record with its decoded range.
 * @throws When the account holds no unspent PositionNFT for the pool —
 *   mint a position first.
 *
 * @example
 * const pos = await selectPositionNFT(client, { program: DEFAULT_PROGRAM, poolKey })
 */
export async function selectPositionNFT(client: Client, params: SelectPositionNFTParameters): Promise<PositionNFTInfo> {
  const records = (await requestRecords(client, {
    program: params.program,
    statusFilter: 'unspent',
  })) as OwnedRecord[]

  for (const record of records) {
    if (!record.recordPlaintext) continue
    let value
    try {
      value = parseRecordPlaintextLoose(record.recordPlaintext)
    } catch {
      continue
    }
    // PositionNFT shape: token_id/token0_id/token1_id/pool/tick_lower/tick_upper.
    const pool = value.fields.pool?.value
    const poolField = typeof pool === 'bigint' ? `${pool}field` : pool
    if (poolField !== params.poolKey) continue
    const tokenIdRaw = value.fields.token_id?.value
    const tokenId = typeof tokenIdRaw === 'bigint' ? `${tokenIdRaw}field` : String(tokenIdRaw ?? '')
    if (params.tokenId !== undefined && tokenId !== params.tokenId) continue
    const tickLower = value.fields.tick_lower?.value
    const tickUpper = value.fields.tick_upper?.value
    if (typeof tickLower !== 'bigint' || typeof tickUpper !== 'bigint') continue
    return { tokenId, tickLower: Number(tickLower), tickUpper: Number(tickUpper), record }
  }

  throw new Error(
    `No unspent PositionNFT for pool ${params.poolKey} on ${params.program}` +
      (params.tokenId ? ` with token_id ${params.tokenId}` : '') +
      ' — mint a position first.',
  )
}

/**
 * A PositionNFT resolved to the record plaintext a local-signer call passes.
 *
 * @property plaintext The PositionNFT record plaintext literal.
 * @property tickLower The position's lower tick, present only when the record
 *   was auto-selected (a caller-supplied literal carries no decoded bounds).
 * @property tickUpper The position's upper tick, present only when
 *   auto-selected.
 */
export type ResolvedPosition = {
  plaintext: string
  tickLower?: number
  tickUpper?: number
}

/**
 * Resolves a PositionNFT to its record plaintext for a local-signer call.
 *
 * Rejects `InputRequest`s (the local path passes literals, never wallet
 * requests), then returns the caller's plaintext as-is or auto-selects the
 * pool's first unspent position. Auto-selection also yields the position's tick
 * bounds; a caller-supplied literal does not, since it is not decoded here.
 *
 * Hits the network only when auto-selecting (a record scan).
 *
 * @param client A Veil wallet client (local account).
 * @param params The optional record, and the program/pool/token id used to
 *   auto-select when no record is given.
 * @returns The record plaintext, plus tick bounds when auto-selected.
 * @throws When `positionRecord` is an `InputRequest`; and, when auto-selecting,
 *   when no matching unspent position exists.
 *
 * @example
 * const { plaintext } = await resolvePositionRecord(client, { program, poolKey })
 */
export async function resolvePositionRecord(
  client: Client,
  params: { positionRecord?: string | InputRequest; program: string; poolKey: string; tokenId?: string },
): Promise<ResolvedPosition> {
  if (typeof params.positionRecord === 'object') {
    throw new Error('Local accounts cannot use InputRequests — pass a record plaintext literal instead')
  }
  if (typeof params.positionRecord === 'string') {
    return { plaintext: params.positionRecord }
  }
  const pos = await selectPositionNFT(client, {
    program: params.program,
    poolKey: params.poolKey,
    tokenId: params.tokenId,
  })
  return { plaintext: pos.record.recordPlaintext, tickLower: pos.tickLower, tickUpper: pos.tickUpper }
}

/**
 * Resolves a token record to its plaintext for a local-signer call.
 *
 * The token-record counterpart to {@link resolvePositionRecord}: rejects
 * `InputRequest`s (the local path passes literals, never wallet requests),
 * returns the caller's plaintext as-is, or auto-selects an unspent record
 * covering the amount from `tokenInProgram`.
 *
 * Hits the network only when auto-selecting (a record scan).
 *
 * @param client A Veil wallet client (local account).
 * @param params The optional record, and the program/token id/minimum amount
 *   used to auto-select when no record is given.
 * @returns The record plaintext literal for the transition input.
 * @throws When `tokenRecord` is an `InputRequest`; when neither `tokenRecord`
 *   nor `tokenInProgram` is given; and, when auto-selecting, when no record
 *   covers the amount.
 *
 * @example
 * const record = await resolveTokenRecord(client, { tokenInProgram, tokenId, minAmount })
 */
export async function resolveTokenRecord(
  client: Client,
  params: { tokenRecord?: string | InputRequest; tokenInProgram?: string; tokenId: string; minAmount: bigint },
): Promise<string> {
  if (typeof params.tokenRecord === 'string') {
    return params.tokenRecord
  }
  if (params.tokenRecord) {
    throw new Error('Local accounts cannot use InputRequests — pass a record plaintext literal instead')
  }
  if (!params.tokenInProgram) {
    throw new Error('tokenInProgram is required to auto-select a record (or pass tokenRecord explicitly)')
  }
  const picked = await selectTokenRecord(client, {
    program: params.tokenInProgram,
    minAmount: params.minAmount,
    tokenId: params.tokenId,
  })
  return picked.record.recordPlaintext
}

/**
 * Extracts a PositionNFT's `token_id` from a record plaintext literal.
 *
 * Applies when a caller-supplied granted plaintext names the position being
 * spent — the id inside the record is authoritative over any id the caller
 * passed alongside it. Pure and local.
 *
 * @param plaintext The PositionNFT record plaintext.
 * @returns The `token_id` field literal, or `undefined` when the plaintext
 *   does not parse or carries no `token_id`.
 *
 * @example
 * const tokenId = positionTokenIdFromPlaintext(grantedRecord)
 */
export function positionTokenIdFromPlaintext(plaintext: string): string | undefined {
  try {
    const raw = parseRecordPlaintextLoose(plaintext).fields.token_id?.value
    return typeof raw === 'bigint' ? `${raw}field` : undefined
  } catch {
    return undefined
  }
}

/**
 * Parameters for {@link getPrivateBalances}.
 *
 * @property programs Token programs to scan — wrapper programs and/or the
 *   token registry. Get them from the API's token list
 *   (`wrapper_program` per token).
 */
export type GetPrivateBalancesParameters = {
  programs: string[]
}

/**
 * Balance summary derived from the caller's own unspent records.
 *
 * Keys are `program` for wrapper-token records, and `program/token_id` for
 * registry records (one registry program holds many tokens). Values are raw
 * atomic sums (u128).
 */
export type GetPrivateBalancesReturnType = Record<string, bigint>

/**
 * Tabulates the caller's private balances from their unspent token records.
 *
 * This is the record-derived, private counterpart to the API's
 * `getPublicBalances` (which reports public/authorized balances for any address):
 * it sums what the caller can actually spend privately, per token.
 *
 * Hits the network (or the wallet's scanner): one `requestRecords` call per
 * program. A privacy-preserving wallet may withhold plaintext for ungranted
 * records — those are skipped, so the total is bounded by what the record
 * grants expose.
 *
 * @param client A Veil wallet client with a record provider.
 * @param params The token programs to scan.
 * @returns Raw atomic sums keyed by `program` (wrapper) or
 *   `program/token_id` (registry).
 *
 * @example
 * const balances = await getPrivateBalances(client, { programs: ['ethx_5a095e.aleo'] })
 * // → { 'ethx_5a095e.aleo': 3000000000000000000n }
 */
export async function getPrivateBalances(client: Client, params: GetPrivateBalancesParameters): Promise<GetPrivateBalancesReturnType> {
  const sums: Record<string, bigint> = {}
  for (const program of params.programs) {
    const records = (await requestRecords(client, { program, statusFilter: 'unspent' })) as OwnedRecord[]
    for (const record of records) {
      if (!record.recordPlaintext) continue
      const info = parseTokenRecordInfo(record.recordPlaintext)
      if (!info) continue
      const key = info.tokenId ? `${program}/${info.tokenId}` : program
      sums[key] = (sums[key] ?? 0n) + info.amount
    }
  }
  return sums
}
