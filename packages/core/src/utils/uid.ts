let count = 0

export function uid(): string {
  return `veil-${count++}`
}
