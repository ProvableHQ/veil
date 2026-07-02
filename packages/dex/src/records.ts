import { requestRecords, parseRecordPlaintextLoose, type Client, type OwnedRecord } from '@veil/core'

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
 *   the indexer's token metadata (`wrapper_program`).
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
 * Parameters for {@link getOwnBalances}.
 *
 * @property programs Token programs to scan — wrapper programs and/or the
 *   token registry. Get them from the indexer's token list
 *   (`wrapper_program` per token).
 */
export type GetOwnBalancesParameters = {
  programs: string[]
}

/**
 * Balance summary derived from the caller's own unspent records.
 *
 * Keys are `program` for wrapper-token records, and `program/token_id` for
 * registry records (one registry program holds many tokens). Values are raw
 * atomic sums (u128).
 */
export type GetOwnBalancesReturnType = Record<string, bigint>

/**
 * Tabulates the caller's private balances from their unspent token records.
 *
 * This is the record-derived, private counterpart to the indexer's
 * `getBalances` (which reports public/authorized balances for any address):
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
 * const balances = await getOwnBalances(client, { programs: ['ethx_5a095e.aleo'] })
 * // → { 'ethx_5a095e.aleo': 3000000000000000000n }
 */
export async function getOwnBalances(client: Client, params: GetOwnBalancesParameters): Promise<GetOwnBalancesReturnType> {
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
