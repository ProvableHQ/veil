import type { RawTransitionResult } from '../types/proving.js'

/**
 * Decryption strategy for a single record ciphertext.
 *
 * Returns the plaintext string if the caller can decrypt it, or `null` if not
 * (e.g. not owned, no view key available). The {@link extractTransitions}
 * function calls this for each record output and drops the entry when `null`
 * is returned — matching the convention that unowned records do not appear in
 * the caller's outputs.
 *
 * When no decryptor is provided, record ciphertexts pass through as raw
 * `record1...` strings. This is the right shape for RPC accounts, where the
 * dApp should not be brokering decryption on behalf of the wallet.
 */
export type Decryptor = (ciphertext: string) => string | null

/**
 * Walk a confirmed transaction's `execution.transitions[]`, optionally decrypt
 * record ciphertexts, and return the structured per-transition outputs plus
 * the top-level transition's outputs.
 *
 * Aleo execution semantics guarantee that the outer/called transition is the
 * last element of `execution.transitions[]` — inner cross-program transitions
 * are recorded before their callers. So `outputs` is derived from
 * `transitions.at(-1)`, with no name matching needed.
 */
export function extractTransitions(
  tx: any,
  decrypt?: Decryptor,
): { transitions: RawTransitionResult[]; outputs: string[] } {
  const rawTransitions: RawTransitionResult[] = []

  for (const transition of tx.execution?.transitions ?? []) {
    const transitionOutputs: string[] = []
    for (const output of transition.outputs ?? []) {
      if (!output.value) continue
      const isRecordCiphertext =
        (output.type === 'record' || output.type === 'record_with_dynamic_id') &&
        typeof output.value === 'string' &&
        output.value.startsWith('record1')

      if (isRecordCiphertext && decrypt) {
        const plaintext = decrypt(output.value)
        if (plaintext !== null) transitionOutputs.push(plaintext)
        // else: not owned — drop (matches local-path semantics)
      } else {
        // Not a record ciphertext, OR no decryptor (RPC path) — pass through verbatim.
        transitionOutputs.push(output.value)
      }
    }
    rawTransitions.push({
      transitionId: transition.id ?? '',
      program: transition.program ?? '',
      function: transition.function ?? '',
      outputs: transitionOutputs,
    })
  }

  return { transitions: rawTransitions, outputs: rawTransitions.at(-1)?.outputs ?? [] }
}
