export class BridgeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BridgeError'
  }
}

export class BridgeEnvelopeError extends BridgeError {
  constructor(message: string) {
    super(message)
    this.name = 'BridgeEnvelopeError'
  }
}

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

export class BridgeTimeoutError extends BridgeError {
  constructor(public readonly orderId: string, public readonly timeoutMs: number) {
    super(`Bridge order ${orderId} did not reach the requested stage within ${timeoutMs}ms`)
    this.name = 'BridgeTimeoutError'
  }
}
