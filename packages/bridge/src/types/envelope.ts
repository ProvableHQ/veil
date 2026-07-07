/**
 * The bridge API's response envelope — every endpoint wraps its payload as
 * `{ data, meta? }`. Actions unwrap it with `unwrapEnvelope`.
 *
 * @property data The endpoint's payload.
 * @property meta Optional request metadata (quote responses carry
 *   `quoteRequestId`, `warnings`, and `providerErrors` here).
 */
export type ApiEnvelope<T> = {
  data: T
  meta?: Record<string, unknown>
}
