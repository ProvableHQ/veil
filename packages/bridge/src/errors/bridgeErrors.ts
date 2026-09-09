/**
 * Represents protocol bridge configuration and planning failures.
 *
 * @example
 * try {
 *   bridge.prepare(params)
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
