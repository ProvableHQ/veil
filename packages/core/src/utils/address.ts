import { InvalidAddressError } from '../errors/errors.js'

const ADDRESS_REGEX = /^aleo1[a-z0-9]{58}$/

export function isAddress(address: string): boolean {
  return ADDRESS_REGEX.test(address)
}

export function assertAddress(address: string): void {
  if (!isAddress(address)) {
    throw new InvalidAddressError(address)
  }
}
