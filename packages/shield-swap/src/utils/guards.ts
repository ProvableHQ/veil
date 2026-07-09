import type { Client } from '@provablehq/veil-core'
import { getPool, type GetPoolReturnType } from '../actions/reads/getPool.js'
import { getSlot, type GetSlotReturnType } from '../actions/reads/getSlot.js'

/** A Veil client's account as the action layer reads it off the client. */
export type ClientAccount = { type: string; address: string; viewKey?: string }

/**
 * Returns the client's account, or throws naming the action that needs one.
 *
 * Centralizes the `client.account` access every write action performs so the
 * unsafe structural cast and the error wording live in one place. Pure and
 * local.
 *
 * @param client A Veil wallet client.
 * @param action The calling action's name, used in the error message.
 * @returns The account (`type`, `address`, and optional `viewKey`).
 * @throws When the client carries no account.
 *
 * @example
 * const account = requireAccount(client, 'burn')
 * const isLocal = account.type === 'local'
 */
export function requireAccount(client: Client, action: string): ClientAccount {
  const account = (client as { account?: ClientAccount }).account
  if (!account) throw new Error(`${action} requires a wallet client with an account`)
  return account
}

/**
 * Reads a pool's state, or throws when it does not exist on the program.
 *
 * Hits the network (one mapping read).
 *
 * @param client A Veil client.
 * @param poolKey Pool key field literal.
 * @param program shield_swap program id to read from.
 * @returns The pool state (never null).
 * @throws When no pool exists for `poolKey` on `program`.
 *
 * @example
 * const pool = await requirePool(client, poolKey, program)
 */
export async function requirePool(
  client: Client,
  poolKey: string,
  program: string,
): Promise<NonNullable<GetPoolReturnType>> {
  const pool = await getPool(client, { poolKey, program })
  if (!pool) throw new Error(`Pool ${poolKey} does not exist on ${program}`)
  return pool
}

/**
 * Reads a pool's slot state, or throws when it is absent.
 *
 * Hits the network (one mapping read).
 *
 * @param client A Veil client.
 * @param poolKey Pool key field literal.
 * @param program shield_swap program id to read from.
 * @returns The slot state (never null).
 * @throws When the pool has no slot state on `program`.
 *
 * @example
 * const slot = await requireSlot(client, poolKey, program)
 */
export async function requireSlot(
  client: Client,
  poolKey: string,
  program: string,
): Promise<NonNullable<GetSlotReturnType>> {
  const slot = await getSlot(client, { poolKey, program })
  if (!slot) throw new Error(`Pool ${poolKey} has no slot state on ${program}`)
  return slot
}
