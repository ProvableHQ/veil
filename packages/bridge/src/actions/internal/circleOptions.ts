import { BridgeError } from '../../errors/bridgeErrors.js'
import type { CircleOptions } from '../../types/actions.js'

/** Deprecated flat fields that an action still accepts beside `circle`. */
type DeprecatedCircleFields = Pick<CircleOptions, 'manualMint' | 'approvalReplacement'>

/**
 * Merges an action's `circle` options with the deprecated flat fields they replace.
 *
 * A value given in both places must agree; otherwise the call is rejected so a
 * caller migrating between forms never has one of them silently ignored. The
 * caller passes CCTP fields explicitly because a quote's `cctp` key carries
 * transfer intent, not these options.
 *
 * @param params Action parameters carrying `circle` and the deprecated `privateMintSecretNonce`.
 * @param deprecated Deprecated CCTP fields read from the action's own `cctp` key, if it has one.
 * @returns The effective Circle options with each deprecated field folded in.
 * @throws BridgeError When a field is supplied in both forms with different values.
 */
export function resolveCircleOptions(
  params: { circle?: CircleOptions | undefined; privateMintSecretNonce?: string | undefined },
  deprecated: DeprecatedCircleFields = {},
): CircleOptions {
  const circle = params.circle ?? {}
  const approvalReplacement = pick(
    'approvalReplacement',
    circle.approvalReplacement,
    deprecated.approvalReplacement,
    (current, legacy) => current.originalTransactionId === legacy.originalTransactionId
      && current.replacementTransactionId === legacy.replacementTransactionId,
  )
  return {
    ...circle,
    manualMint: pick('manualMint', circle.manualMint, deprecated.manualMint),
    approvalReplacement,
    privateMintSecretNonce: pick('privateMintSecretNonce', circle.privateMintSecretNonce, params.privateMintSecretNonce),
  }
}

function pick<T>(
  name: string,
  current: T | undefined,
  legacy: T | undefined,
  same: (current: T, legacy: T) => boolean = (a, b) => a === b,
): T | undefined {
  if (current !== undefined && legacy !== undefined && !same(current, legacy)) {
    throw new BridgeError(`circle.${name} conflicts with the deprecated top-level option`)
  }
  return current ?? legacy
}
