export type ParsedValue = {
  value: bigint | boolean | string
  type: string
}

const INTEGER_REGEX = /^(-?\d+)(u8|u16|u32|u64|u128|i8|i16|i32|i64|i128|field|scalar|group)$/

export function parseValue(raw: string): ParsedValue {
  if (raw === 'true') return { value: true, type: 'boolean' }
  if (raw === 'false') return { value: false, type: 'boolean' }
  if (raw.startsWith('aleo1')) return { value: raw, type: 'address' }

  const match = raw.match(INTEGER_REGEX)
  if (match) {
    return { value: BigInt(match[1]!), type: match[2]! }
  }

  return { value: raw, type: 'string' }
}

export function encodeValue(value: bigint | boolean | string, type: string): string {
  if (type === 'boolean') return String(value)
  if (type === 'address' || type === 'string') return String(value)
  return `${value}${type}`
}
