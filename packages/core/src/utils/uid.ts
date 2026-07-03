let count = 0

/**
 * Generates a short identifier unique within the current process
 * (`veil-0`, `veil-1`, ...). Used to correlate client requests; not
 * cryptographically random and not unique across processes. Pure and
 * local, aside from advancing the module-level counter.
 *
 * @returns The next identifier in the sequence.
 *
 * @example
 * const id = uid() // 'veil-0'
 */
export function uid(): string {
  return `veil-${count++}`
}
