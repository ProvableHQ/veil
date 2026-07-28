import { describe, it, expect } from 'vitest'
import { parseFuture, isFutureText } from '../../src/utils/records.js'

const ADDR = 'aleo1rhgdu77hgyqd3xjcrf64wgs7wyehnhvw2rgvfgu6yheugf5fs5zsxwwm5h'

const simple = `{
  program_id: credits.aleo,
  function_name: transfer_public,
  arguments: [
    ${ADDR},
    100000u64
  ]
}`

const nested = `{
  program_id: shield_swap.aleo,
  function_name: swap,
  arguments: [
    42field,
    {
      program_id: credits.aleo,
      function_name: transfer_public_as_signer,
      arguments: [
        ${ADDR},
        5u64
      ]
    }
  ]
}`

describe('parseFuture', () => {
  it('parses program id, function name, and plaintext arguments', () => {
    expect(parseFuture(simple)).toEqual({
      programId: 'credits.aleo',
      function: 'transfer_public',
      arguments: [ADDR, 100000n],
    })
  })

  it('parses nested future arguments recursively', () => {
    expect(parseFuture(nested)).toEqual({
      programId: 'shield_swap.aleo',
      function: 'swap',
      arguments: [
        42n,
        {
          programId: 'credits.aleo',
          function: 'transfer_public_as_signer',
          arguments: [ADDR, 5n],
        },
      ],
    })
  })

  it('parses struct-valued arguments as plain StructValues', () => {
    const future = parseFuture(`{
  program_id: p.aleo,
  function_name: f,
  arguments: [
    { hi: 1u128, lo: 0u128 }
  ]
}`)
    expect(future.arguments).toEqual([{ hi: 1n, lo: 0n }])
  })

  it('parses empty arguments', () => {
    expect(parseFuture('{ program_id: p.aleo, function_name: f, arguments: [] }').arguments).toEqual([])
  })

  it('throws on non-future text', () => {
    expect(() => parseFuture('{ token0: 11field, fee: 3000u32 }')).toThrow(/future/i)
  })
})

describe('isFutureText', () => {
  it('accepts future text', () => {
    expect(isFutureText(simple)).toBe(true)
    expect(isFutureText(nested)).toBe(true)
  })

  it('rejects struct plaintext and record plaintext', () => {
    expect(isFutureText('{ token0: 11field, fee: 3000u32 }')).toBe(false)
    expect(isFutureText(`{ owner: ${ADDR}.private, points: 1u64.private, _nonce: 0group.public }`)).toBe(false)
  })

  it('ignores nested future arguments when the top level is not a future', () => {
    expect(isFutureText(`{ inner: { program_id: p.aleo, function_name: f, arguments: [] } }`)).toBe(false)
  })
})
