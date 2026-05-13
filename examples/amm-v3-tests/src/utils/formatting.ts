export function toField(value: string | bigint): string {
  if (typeof value === 'bigint') return `${value}field`
  return value.endsWith('field') ? value : `${value}field`
}

export function fromField(value: string): string {
  return value.replace(/field$/, '')
}

export function toU128(value: bigint): string {
  return `${value}u128`
}

export function fromU128(value: string): bigint {
  return BigInt(value.replace(/u128$/, ''))
}

export function toU64(value: bigint | number): string {
  return `${value}u64`
}

export function fromU64(value: string): bigint {
  return BigInt(value.replace(/u64$/, ''))
}

export function toU32(value: number): string {
  return `${value}u32`
}

export function fromU32(value: string): number {
  return parseInt(value.replace(/u32$/, ''), 10)
}

export function toU16(value: number): string {
  return `${value}u16`
}

export function fromU16(value: string): number {
  return parseInt(value.replace(/u16$/, ''), 10)
}

export function toU8(value: number): string {
  return `${value}u8`
}

export function fromU8(value: string): number {
  return parseInt(value.replace(/u8$/, ''), 10)
}

export function toI32(value: number): string {
  return `${value}i32`
}

export function fromI32(value: string): number {
  return parseInt(value.replace(/i32$/, ''), 10)
}

export function toI128(value: bigint): string {
  return `${value}i128`
}

export function fromI128(value: string): bigint {
  return BigInt(value.replace(/i128$/, ''))
}

export function toBool(value: boolean): string {
  return value ? 'true' : 'false'
}

export function fromBool(value: string): boolean {
  return value === 'true'
}

export function toAddress(value: string): string {
  if (!value.startsWith('aleo1')) throw new Error(`Invalid Aleo address: ${value}`)
  return value
}

export function formatStructForCLI(fields: Record<string, string>): string {
  const entries = Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')
  return `{ ${entries} }`
}

export function parseStruct(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  const content = raw.replace(/^\s*\{/, '').replace(/\}\s*$/, '').trim()

  let depth = 0
  let current = ''
  const parts: string[] = []

  for (const char of content) {
    if (char === '{') depth++
    else if (char === '}') depth--
    else if (char === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) parts.push(current.trim())

  for (const part of parts) {
    const colonIdx = part.indexOf(':')
    if (colonIdx !== -1) {
      result[part.slice(0, colonIdx).trim()] = part.slice(colonIdx + 1).trim()
    }
  }

  return result
}
