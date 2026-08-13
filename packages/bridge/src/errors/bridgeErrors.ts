/**
 * Represents protocol bridge configuration and planning failures.
 *
 * @example
 * try {
 *   bridge.prepareTransfer(params)
 * } catch (error) {
 *   if (error instanceof BridgeError) console.error(error.message)
 * }
 */
export class BridgeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BridgeError'
  }
}
