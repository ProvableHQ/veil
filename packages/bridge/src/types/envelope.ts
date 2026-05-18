export type ApiEnvelope<T> = {
  data: T
  meta?: Record<string, unknown>
}
