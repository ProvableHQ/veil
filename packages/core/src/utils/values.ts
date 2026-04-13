import type { Primitive } from '../types/primitives.js'

export type ParsedValue = {
  value: bigint | boolean | string
  type: Primitive
}

const INTEGER_REGEX = /^(-?\d+)(u8|u16|u32|u64|u128|i8|i16|i32|i64|i128|field|scalar|group)$/

export function parseValue(raw: string): ParsedValue {
  if (raw === 'true') return { value: true, type: 'boolean' }
  if (raw === 'false') return { value: false, type: 'boolean' }
  if (raw.startsWith('aleo1')) return { value: raw, type: 'address' }

  const match = raw.match(INTEGER_REGEX)
  if (match) {
    return { value: BigInt(match[1]!), type: match[2]! as Primitive }
  }

  throw new Error(`Cannot parse value: ${raw}`)
}

export function encodeValue(value: bigint | boolean | string, type: Primitive): string {
  if (type === 'boolean') return String(value)
  if (type === 'address' || type === 'signature' || type === 'identifier') return String(value)
  return `${value}${type}`
}
