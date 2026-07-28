// A bare BHP256 id output: a decimal followed by the `field` suffix.
const FIELD_LITERAL = /^\d+field$/

/**
 * Returns the sole public `field`-literal output of a transition — the id a
 * write returns (swap id, position token id, pool key).
 *
 * The transitions these actions dispatch to each emit exactly one bare `field`
 * output; the rest are records, futures, or an address. A positional read is
 * NOT reliable across direct vs routed dispatch: a router prepends forwarded
 * change records, and `extractTransitions` drops records that carry no
 * plaintext value, so the id's index shifts. Matching the `field` literal is
 * stable regardless.
 *
 * Requiring exactly one match keeps the invariant loud: a future transition
 * that emitted a second public `field` (e.g. an auxiliary key beside the id)
 * throws here rather than silently returning the wrong one.
 *
 * @param outputs The transition outputs, as returned by a write.
 * @param context Names the calling transition for the error message.
 * @returns The `field`-literal id.
 * @throws When zero, or more than one, `field` output is present — the shape is
 *   not what the id read assumes.
 */
export function requireFieldOutput(outputs: readonly string[], context: string): string {
  const fields = outputs.filter((o) => FIELD_LITERAL.test(o))
  if (fields.length !== 1) {
    throw new Error(
      `Unexpected ${context} output shape: expected one field output, found ${fields.length} in ${JSON.stringify(outputs)}`,
    )
  }
  return fields[0]!
}
