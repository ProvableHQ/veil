// ---- Primitive Type descriptors ----
// Used in the ABI to describe the shape of inputs, outputs, fields, mappings.

/** An Aleo literal type name, as the ABI uses it to describe inputs, outputs, fields, and mapping keys/values. */
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

/**
 * A plaintext type descriptor: a primitive, an array, a struct reference, or an optional.
 *
 * The `struct` variant is a reference to a struct by name, not its full
 * definition. Full struct definitions live in abi.ts as `StructDef`.
 */
export type Plaintext =
  | { kind: 'primitive'; primitive: Primitive }
  | { kind: 'array'; element: Plaintext; length: number }
  | { kind: 'struct'; path: string[]; program?: string }
  | { kind: 'optional'; inner: Plaintext }

// ---- Runtime values ----
// The actual data passed to/received from transitions at runtime.

/** An Aleo account address ("aleo1..."). */
export type Address = string
/** A base-field element in Aleo text form (e.g. "123field"). */
export type Field = string
/** A group element (curve point) in Aleo text form. */
export type Group = string
/** A scalar-field element in Aleo text form. */
export type Scalar = string
/** A signature in Aleo text form ("sign1..."). */
export type Signature = string

// All integer plaintext literals are represented as bigint at runtime
// to match parsing/encoding behavior consistently across bit widths.

/** Runtime value of an Aleo u8 literal (bigint, like all integer literals). */
export type U8 = bigint
/** Runtime value of an Aleo u16 literal. */
export type U16 = bigint
/** Runtime value of an Aleo u32 literal. */
export type U32 = bigint
/** Runtime value of an Aleo u64 literal. */
export type U64 = bigint
/** Runtime value of an Aleo u128 literal. */
export type U128 = bigint
/** Runtime value of an Aleo i8 literal. */
export type I8 = bigint
/** Runtime value of an Aleo i16 literal. */
export type I16 = bigint
/** Runtime value of an Aleo i32 literal. */
export type I32 = bigint
/** Runtime value of an Aleo i64 literal. */
export type I64 = bigint
/** Runtime value of an Aleo i128 literal. */
export type I128 = bigint

/** Any Aleo literal value at runtime: a boolean, an integer bigint, or an Aleo-text string. */
export type Literal =
  | Address | boolean | Field | Group | Scalar | Signature
  | U8 | U16 | U32 | U64 | U128
  | I8 | I16 | I32 | I64 | I128

/** A struct value at runtime: named fields mapped to their plaintext values. */
export type StructValue = { [field: string]: PlaintextValue }

/** An array value at runtime. */
export type ArrayValue = PlaintextValue[]

/** Any plaintext value at runtime: a literal, a struct, or an array. */
export type PlaintextValue = Literal | StructValue | ArrayValue

/**
 * One entry of a record value at runtime: its value, visibility mode, and
 * Aleo type descriptor. Mirrors snarkVM's `Entry`, which scopes visibility
 * per entry — `constant`, `public`, or `private`.
 *
 * @property type Aleo type of `value` (e.g. `{ kind: 'primitive', primitive: 'u64' }`).
 *   Carried so a RecordValue can self-serialize back to plaintext without the
 *   RecordDef — a bigint value of 1000n could be u64, u128, field, or i64,
 *   indistinguishable at runtime since the TypeScript aliases (U64 = bigint) erase.
 */
export type RecordFieldValue = {
  value: PlaintextValue
  mode: 'constant' | 'public' | 'private'
  type: Plaintext
}

/**
 * A record value at runtime. Mirrors snarkVM's `Record`: a visibility-scoped
 * owner, named entries carrying their own visibility mode and Aleo type
 * descriptor, a nonce, and a commitment-scheme version.
 *
 * @property ownerMode Visibility of the owner address — the owner is itself
 *   visibility-scoped in snarkVM, independently of the data entries.
 * @property program Program the record belongs to (e.g. "loyalty_token.aleo").
 * @property recordName Record type name (e.g. "LoyaltyCard").
 * @property nonce Group element that makes the record's commitment unique.
 * @property version Record commitment version: 0 derives the commitment with
 *   a BHP hash, 1 with a BHP commitment. Defaults to 0 when the plaintext
 *   carries no `_version` tag.
 * @property raw Original record plaintext when the value came from
 *   `parseRecord`. Serialization returns it verbatim, making the round-trip
 *   exact; absent on hand-constructed values.
 */
export type RecordValue = {
  owner: Address
  ownerMode: 'public' | 'private'
  program: string
  recordName: string
  fields: { [name: string]: RecordFieldValue }
  nonce: string
  version: number
  raw?: string
}

/**
 * A future returned by an async transition: the pending on-chain finalize
 * call, naming the program, function, and arguments it will run with.
 */
export type FutureValue = {
  programId: string
  function: string
  arguments: (FutureValue | PlaintextValue)[]
}
