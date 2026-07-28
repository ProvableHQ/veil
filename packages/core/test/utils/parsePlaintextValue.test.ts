import { describe, it, expect } from 'vitest'
import { parsePlaintextValue } from '../../src/utils/records.js'

describe('parsePlaintextValue', () => {
  it('parses integer literals to bigint', () => {
    expect(parsePlaintextValue('3000u32')).toBe(3000n)
    expect(parsePlaintextValue('-5i64')).toBe(-5n)
    expect(parsePlaintextValue('123field')).toBe(123n)
  })

  it('parses boolean literals', () => {
    expect(parsePlaintextValue('true')).toBe(true)
    expect(parsePlaintextValue('false')).toBe(false)
  })

  it('parses addresses as strings', () => {
    const addr = 'aleo1rhgdu77hgyqd3xjcrf64wgs7wyehnhvw2rgvfgu6yheugf5fs5zsxwwm5h'
    expect(parsePlaintextValue(addr)).toBe(addr)
  })

  it('parses structs to nested StructValue objects', () => {
    expect(parsePlaintextValue('{ a: 1u8, b: { c: 2field } }')).toEqual({ a: 1n, b: { c: 2n } })
  })

  it('parses arrays', () => {
    expect(parsePlaintextValue('[1u8, 2u8]')).toEqual([1n, 2n])
  })

  it('parses arrays of structs', () => {
    expect(parsePlaintextValue('[{ x: 1u8 }, { x: 2u8 }]')).toEqual([{ x: 1n }, { x: 2n }])
  })

  it('keeps unrecognized scalars as raw strings', () => {
    expect(parsePlaintextValue('token_registry.aleo')).toBe('token_registry.aleo')
  })

  it('parses a realistic mapping value', () => {
    const plaintext = `{
  token0: 3412897813field,
  token1: 8891236412field,
  fee: 3000u32,
  enabled: true
}`
    expect(parsePlaintextValue(plaintext)).toEqual({
      token0: 3412897813n,
      token1: 8891236412n,
      fee: 3000n,
      enabled: true,
    })
  })

  it('throws on empty input', () => {
    expect(() => parsePlaintextValue('')).toThrow()
    expect(() => parsePlaintextValue('   ')).toThrow()
  })
})
