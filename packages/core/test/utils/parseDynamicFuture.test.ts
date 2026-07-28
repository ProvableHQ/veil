import { describe, it, expect } from 'vitest'
import { parseDynamicFuture, isDynamicFutureText, parseFuture } from '../../src/utils/records.js'

// Field encodings are the little-endian byte packing of the ASCII identifier
// (snarkVM Identifier::from_str → Field::from_bits_le(bytes LE)):
// "foo" → 0x6F6F66 = 7303014, "aleo" → 0x6F656C61 = 1868917857, "bar" → 0x726162 = 7496034
const humanReadable = '{ _program_id: foo.aleo, _function_name: bar, _checksum: 3field }'
const rawFields =
  '{ _program_name: 7303014field, _program_network: 1868917857field, _function_name: 7496034field, _checksum: 3field }'

describe('parseDynamicFuture', () => {
  it('parses the raw field form verbatim', () => {
    expect(parseDynamicFuture(rawFields)).toEqual({
      programName: '7303014field',
      programNetwork: '1868917857field',
      functionName: '7496034field',
      checksum: '3field',
    })
  })

  it('normalizes the human-readable form to the same field values', () => {
    expect(parseDynamicFuture(humanReadable)).toEqual(parseDynamicFuture(rawFields))
  })

  it('throws on non-dynamic-future text', () => {
    expect(() => parseDynamicFuture('{ token0: 11field, fee: 3000u32 }')).toThrow(/dynamic future/i)
    expect(() => parseDynamicFuture('{ program_id: p.aleo, function_name: f, arguments: [] }')).toThrow(
      /dynamic future/i,
    )
  })
})

describe('isDynamicFutureText', () => {
  it('accepts both textual forms', () => {
    expect(isDynamicFutureText(humanReadable)).toBe(true)
    expect(isDynamicFutureText(rawFields)).toBe(true)
  })

  it('rejects static future, struct, and record text', () => {
    expect(isDynamicFutureText('{ program_id: p.aleo, function_name: f, arguments: [] }')).toBe(false)
    expect(isDynamicFutureText('{ token0: 11field, fee: 3000u32 }')).toBe(false)
    expect(isDynamicFutureText('{ owner: aleo1abc.private, points: 1u64.private, _nonce: 0group.public }')).toBe(false)
  })
})

describe('parseFuture with dynamic future arguments', () => {
  it('converts nested dynamic futures recursively', () => {
    const future = parseFuture(`{
  program_id: router.aleo,
  function_name: dispatch,
  arguments: [
    42field,
    ${humanReadable}
  ]
}`)
    expect(future.arguments).toEqual([
      42n,
      {
        programName: '7303014field',
        programNetwork: '1868917857field',
        functionName: '7496034field',
        checksum: '3field',
      },
    ])
  })
})
