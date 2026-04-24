/**
 * Minimal runtime shape validator for fixture-driven tests. No zod dependency.
 *
 * Spec grammar:
 *   'string' | 'number' | 'boolean' | 'bigint' | 'null'
 *   | { __nullable: Spec }                  — allows null/undefined + Spec
 *   | { __array: Spec }                     — array whose items match Spec
 *   | { __union: [Spec, ...Spec[]] }        — matches any Spec in the list
 *   | { [field: string]: Spec }             — object with required typed fields
 */
export type ShapePrimitive = 'string' | 'number' | 'boolean' | 'bigint' | 'null' | 'unknown'
export type ShapeSpec =
  | ShapePrimitive
  | { __nullable: ShapeSpec }
  | { __array: ShapeSpec }
  | { __union: [ShapeSpec, ...ShapeSpec[]] }
  | { [field: string]: ShapeSpec }

export function assertShape(value: unknown, spec: ShapeSpec, path = '<root>'): void {
  if (typeof spec === 'string') {
    if (spec === 'unknown') return // matches anything
    if (spec === 'null') {
      if (value !== null) throw new Error(`${path}: expected null, got ${kindOf(value)}`)
      return
    }
    if (typeof value !== spec) {
      throw new Error(`${path}: expected ${spec}, got ${kindOf(value)} (${safeStringify(value)})`)
    }
    return
  }

  if ('__nullable' in spec) {
    if (value === null || value === undefined) return
    assertShape(value, spec.__nullable, path)
    return
  }

  if ('__array' in spec) {
    if (!Array.isArray(value)) throw new Error(`${path}: expected array, got ${kindOf(value)}`)
    value.forEach((item, i) => assertShape(item, spec.__array, `${path}[${i}]`))
    return
  }

  if ('__union' in spec) {
    const errors: string[] = []
    for (const branch of spec.__union) {
      try {
        assertShape(value, branch, path)
        return
      } catch (err) {
        errors.push((err as Error).message)
      }
    }
    throw new Error(`${path}: no union branch matched:\n  - ${errors.join('\n  - ')}`)
  }

  // Object spec
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path}: expected object, got ${kindOf(value)}`)
  }
  const v = value as Record<string, unknown>
  for (const [key, subSpec] of Object.entries(spec)) {
    assertShape(v[key], subSpec, `${path}.${key}`)
  }
}

function kindOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function safeStringify(value: unknown): string {
  try {
    const s = JSON.stringify(value)
    return s.length > 80 ? `${s.slice(0, 77)}...` : s
  } catch {
    return String(value)
  }
}
