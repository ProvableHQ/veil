// A bare BHP256 id output: a decimal followed by the `field` suffix.
const FIELD_LITERAL = /^\d+field$/

/**
 * Returns the first public `field`-literal output of a transition — the id a
 * write returns (swap id, position token id, pool key).
 *
 * The transitions these actions dispatch to each emit exactly one bare `field`
 * output; the rest are records, futures, or an address. A positional read is
 * NOT reliable across direct vs routed dispatch: a router prepends forwarded
 * change records, and `extractTransitions` drops records that carry no
 * plaintext value, so the id's index shifts. Matching the `field` literal is
 * stable regardless.
 *
 * @param outputs The transition outputs, as returned by a write.
 * @param context Names the calling transition for the error message.
 * @returns The `field`-literal id.
 * @throws When no `field` output is present — the shape is unexpected.
 */
export function requireFieldOutput(outputs: readonly string[], context: string): string {
  const field = outputs.find((o) => FIELD_LITERAL.test(o))
  if (!field) {
    throw new Error(`Unexpected ${context} output shape: ${JSON.stringify(outputs)}`)
  }
  return field
}
