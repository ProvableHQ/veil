// ---- Primitive Type descriptors ----
// Used in the ABI to describe the shape of inputs, outputs, fields, mappings.

export type Primitive =
  | 'address'
  | 'boolean'
  | 'field'
  | 'group'
  | 'identifier'
  | 'scalar'
  | 'signature'
  | 'u8' | 'u16' | 'u32' | 'u64' | 'u128'
  | 'i8' | 'i16' | 'i32' | 'i64' | 'i128'

// A plaintext type descriptor: primitives, arrays, struct references, optionals.
// Note: this is a REFERENCE to a struct by name, not its full definition.
// Full struct definitions live in abi.ts as StructDef.
export type Plaintext =
  | { kind: 'primitive'; primitive: Primitive }
  | { kind: 'array'; element: Plaintext; length: number }
  | { kind: 'struct'; path: string[]; program?: string }
  | { kind: 'optional'; inner: Plaintext }

// ---- Runtime values ----
// The actual data passed to/received from transitions at runtime.

export type Address = string
export type Field = string
export type Group = string
export type Scalar = string
export type Signature = string

// All integer plaintext literals are represented as bigint at runtime
// to match parsing/encoding behavior consistently across bit widths.
export type U8 = bigint
export type U16 = bigint
export type U32 = bigint
export type U64 = bigint
export type U128 = bigint
export type I8 = bigint
export type I16 = bigint
export type I32 = bigint
export type I64 = bigint
export type I128 = bigint

export type Literal =
  | Address | boolean | Field | Group | Scalar | Signature
  | U8 | U16 | U32 | U64 | U128
  | I8 | I16 | I32 | I64 | I128

// Struct value at runtime: named fields
export type StructValue = { [field: string]: PlaintextValue }

// Array value at runtime
export type ArrayValue = PlaintextValue[]

// Any plaintext value at runtime
export type PlaintextValue = Literal | StructValue | ArrayValue

// Record value at runtime. Always has owner + nonce, plus named fields
// with their visibility mode and Aleo type descriptor.
//
// The `type` field carries the Aleo type (e.g. { kind: 'primitive', primitive: 'u64' })
// so that RecordValue can self-serialize back to plaintext without needing the RecordDef.
// Without it, a bigint value of 1000n could be u64, u128, field, or i64 —
// indistinguishable at runtime since TypeScript type aliases (U64 = bigint) erase.
export type RecordFieldValue = {
  value: PlaintextValue
  mode: 'public' | 'private'
  type: Plaintext
}

export type RecordValue = {
  owner: Address
  program: string       // program this record belongs to (e.g. "loyalty_token.aleo")
  recordName: string    // record type name (e.g. "LoyaltyCard")
  fields: { [name: string]: RecordFieldValue }
  nonce: string
}

// Future returned by async transitions
export type FutureValue = {
  programId: string
  function: string
  arguments: (FutureValue | PlaintextValue)[]
}
