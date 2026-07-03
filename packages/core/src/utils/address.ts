import { InvalidAddressError } from '../errors/errors.js'

const ADDRESS_REGEX = /^aleo1[a-z0-9]{58}$/

/**
 * Checks whether a string is a well-formed Aleo address — "aleo1" followed
 * by 58 lowercase alphanumeric characters. Pure and local; validates shape
 * only, not whether the address exists on-chain.
 *
 * @param address Candidate string.
 * @returns True when the shape is valid.
 *
 * @example
 * isAddress('aleo1abc') // false — too short
 */
export function isAddress(address: string): boolean {
  return ADDRESS_REGEX.test(address)
}

/**
 * Validates an address shape and throws when it fails. Use at input
 * boundaries where an invalid address should stop the call early rather
 * than fail deep in a transaction build. Pure and local.
 *
 * @param address Candidate string.
 * @throws InvalidAddressError When the string is not a well-formed Aleo
 *   address.
 *
 * @example
 * assertAddress(params.to) // throws before any fee is spent
 */
export function assertAddress(address: string): void {
  if (!isAddress(address)) {
    throw new InvalidAddressError(address)
  }
}
