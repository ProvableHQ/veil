import type { BridgeRouteStatus, BridgeRouteStatusSource } from '../types/actions.js'

/**
 * Represents protocol bridge configuration and planning failures.
 *
 * @example
 * try {
 *   await bridge.quote(params)
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

/**
 * Reports a refused transfer because an on-chain pause flag on the route is set.
 *
 * Thrown by execute, resume, and complete before any wallet interaction. The attached
 * status lists every flag that was read, so a caller can show which program
 * or contract is halted.
 *
 * @property status Route status that triggered the refusal, including each paused source.
 * @example
 * try {
 *   await bridge.execute({ plan })
 * } catch (error) {
 *   if (error instanceof BridgeRoutePausedError) console.error(error.status.sources.filter((s) => s.state === 'paused'))
 * }
 */
export class BridgeRoutePausedError extends BridgeError {
  readonly status: BridgeRouteStatus

  constructor(status: BridgeRouteStatus, options?: ErrorOptions) {
    const paused = status.sources.filter((source) => source.state === 'paused').map(describePauseSource)
    super(`Bridge route ${status.routeId} is paused on chain: ${paused.join(', ')}`, options)
    this.name = 'BridgeRoutePausedError'
    this.status = status
  }
}

/** Formats a pause source as `program/mapping[key]` or `chain:address` for error messages. */
export function describePauseSource(source: BridgeRouteStatusSource): string {
  return source.kind === 'aleo-mapping'
    ? `${source.program}/${source.mapping}[${source.key}]`
    : `${source.chainId}:${source.address}`
}
