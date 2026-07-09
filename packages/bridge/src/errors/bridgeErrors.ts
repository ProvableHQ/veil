/**
 * Base class for every error `@provablehq/veil-bridge` throws itself.
 *
 * Transport-level failures (4xx/5xx responses) surface as `TransportError`
 * from `@provablehq/veil-core` instead; catch both when wrapping bridge calls.
 */
export class BridgeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BridgeError'
  }
}

/**
 * Thrown when a bridge API response is not the expected `{ data, meta? }`
 * envelope — a malformed body, or an envelope missing a field the endpoint
 * always carries (e.g. quotes without `meta.quoteRequestId`).
 */
export class BridgeEnvelopeError extends BridgeError {
  constructor(message: string) {
    super(message)
    this.name = 'BridgeEnvelopeError'
  }
}

/**
 * Thrown by `waitForOrder` (and `swap` when polling) when an order ends in a
 * failure stage rather than reaching the awaited one.
 *
 * @property stage The terminal stage (`FAILED`, `EXPIRED`, `REFUNDED`, `DELETED`).
 * @property orderId The order that failed.
 * @property reason The provider/system reason message, when the API supplied one.
 */
export class BridgeOrderFailedError extends BridgeError {
  constructor(
    public readonly stage: string,
    public readonly orderId: string,
    public readonly reason?: string,
  ) {
    super(`Bridge order ${orderId} ended in terminal stage ${stage}${reason ? `: ${reason}` : ''}`)
    this.name = 'BridgeOrderFailedError'
  }
}

/**
 * Thrown by `waitForOrder` (and `swap` when polling) when the deadline passes
 * before the order reaches the awaited stage. The order itself may still
 * complete — check `getOrder` before treating the swap as failed.
 *
 * @property orderId The order being waited on.
 * @property timeoutMs The deadline that was exceeded.
 */
export class BridgeTimeoutError extends BridgeError {
  constructor(public readonly orderId: string, public readonly timeoutMs: number) {
    super(`Bridge order ${orderId} did not reach the requested stage within ${timeoutMs}ms`)
    this.name = 'BridgeTimeoutError'
  }
}
