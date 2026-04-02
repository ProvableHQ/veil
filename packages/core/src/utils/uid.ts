let count = 0

export function uid(): string {
  return `aleo-viem-${count++}`
}
