// Type-level ABI inference — maps Aleo ABI types to TypeScript types at compile time.
//
// These conditional types enable getContract to narrow function/mapping names
// and infer output types when the ABI is passed as a literal type.
// Complements @veil/codegen — codegen provides richer DX (named params, typed
// record interfaces), while these types provide autocomplete and basic type
// safety without a build step.

import type { Primitive, Plaintext, RecordValue, FutureValue } from './primitives.js'
import type { ABI, StructDef, FunctionOutput } from './abi.js'
import type { Program } from './program.js'
import type { InputValue } from './contract.js'
import type { InputRequest } from './inputRequest.js'

// ── Primitive → TypeScript ───────────────────────────────────────────

/** Maps an Aleo Primitive to its TypeScript runtime type.
 *  Keep discriminants in sync with the Primitive union in primitives.ts. */
export type PrimitiveToTs<P extends Primitive> =
  P extends 'address' | 'field' | 'group' | 'scalar' | 'signature' | 'identifier' ? string :
  P extends 'boolean' ? boolean :
  P extends 'u8' | 'u16' | 'u32' | 'u64' | 'u128' | 'i8' | 'i16' | 'i32' | 'i64' | 'i128' ? bigint :
  unknown

// ── Struct resolution ────────────────────────────────────────────────

/** Extract the last element of a string[] path (the struct name) */
type LastElement<T extends readonly string[]> =
  T extends readonly [...infer _Rest, infer Last extends string] ? Last : string

/** Find a StructDef by matching the last path element against the struct name */
type FindStruct<Structs extends readonly StructDef[], Name extends string> =
  Structs extends readonly [infer S extends StructDef, ...infer Rest extends readonly StructDef[]]
    ? LastElement<S['path']> extends Name ? S : FindStruct<Rest, Name>
    : never

/** Max recursion depth for nested struct resolution (tuple length as counter) */
type MaxDepth = [0, 0, 0, 0, 0, 0, 0, 0]  // 8 levels

/** Resolve a StructDef's fields into a typed object, with depth tracking */
type ResolveStructFields<S extends StructDef, A extends ABI, Depth extends any[]> = {
  [F in S['fields'][number] as F['name']]: PlaintextToTsD<F['type'], A, Depth>
}

/** Depth-limited plaintext mapping — caps struct recursion to prevent TS2589 */
type PlaintextToTsD<P extends Plaintext, A extends ABI, Depth extends any[]> =
  P extends { kind: 'primitive'; primitive: infer Prim extends Primitive } ? PrimitiveToTs<Prim> :
  P extends { kind: 'array'; element: infer E extends Plaintext } ? PlaintextToTsD<E, A, Depth>[] :
  P extends { kind: 'optional'; inner: infer I extends Plaintext } ? PlaintextToTsD<I, A, Depth> | undefined :
  P extends { kind: 'struct'; path: infer Path extends readonly string[] }
    ? Depth['length'] extends MaxDepth['length']
      ? Record<string, unknown>  // depth exceeded — fall back
      : FindStruct<A['structs'], LastElement<Path>> extends infer S extends StructDef
        ? ResolveStructFields<S, A, [...Depth, 0]>
        : Record<string, unknown>
    :
  unknown

// ── Plaintext → TypeScript (recursive) ───────────────────────────────

/**
 * Maps a Plaintext type descriptor to its TypeScript runtime type.
 * When an ABI is provided, struct references are resolved to typed objects
 * using the struct definitions in abi.structs.
 */
/** Public entry point — starts recursion at depth 0 */
export type PlaintextToTs<P extends Plaintext, A extends ABI = ABI> = PlaintextToTsD<P, A, []>

// ── FunctionOutput → TypeScript ──────────────────────────────────────

/** Maps a single FunctionOutput to its TypeScript type.
 *  Keep discriminants in sync with the FunctionOutput union in abi.ts. */
export type OutputToTs<O extends FunctionOutput, A extends ABI = ABI> =
  O extends { kind: 'plaintext'; type: infer P extends Plaintext } ? PlaintextToTs<P, A> :
  O extends { kind: 'record' } ? RecordValue :
  O extends { kind: 'dynamicRecord' } ? RecordValue :
  O extends { kind: 'future' } ? FutureValue :
  O extends { kind: 'dynamicFuture' } ? FutureValue :
  unknown

// ── ABI extraction ───────────────────────────────────────────────────

/** Extract the union of function names from an ABI */
export type FunctionNames<A extends ABI> = A['functions'][number]['name']

/** Extract the union of mapping names from an ABI */
export type MappingNames<A extends ABI> = A['mappings'][number]['name']

/** Extract a specific function definition by name */
export type ExtractFunction<A extends ABI, N extends string> =
  Extract<A['functions'][number], { name: N }>

/** Extract a specific mapping definition by name */
export type ExtractMapping<A extends ABI, N extends string> =
  Extract<A['mappings'][number], { name: N }>

// ── Typed contract namespaces ────────────────────────────────────────

/** Parsed output from the proxy — either a RecordValue or the raw string */
type ParsedOutput = RecordValue | string

type SimulateParams = { inputs: (InputValue | InputRequest)[]; imports?: Record<string, string> }
type ExecuteParams = { inputs: (InputValue | InputRequest)[]; imports?: Record<string, string> }
type WriteParams = { inputs: (InputValue | InputRequest)[]; imports?: Record<string, string> }

/** Check if the ABI has literal (narrowed) names or is widened to `string` */
type IsLiteral<T extends string> = string extends T ? false : true

/** Typed read methods — narrows to known mapping names when ABI is literal */
export type TypedReadMethods<A extends ABI> =
  IsLiteral<MappingNames<A>> extends true
    ? { [N in MappingNames<A>]: (params: { key: string }) => Promise<unknown> }
    : Record<string, (params: { key: string }) => Promise<unknown>>

/** Typed simulate methods — narrows to known function names when ABI is literal */
export type TypedSimulateMethods<A extends ABI> =
  IsLiteral<FunctionNames<A>> extends true
    ? { [N in FunctionNames<A>]: (params: SimulateParams) => Promise<{ outputs: ParsedOutput[] }> }
    : Record<string, (params: SimulateParams) => Promise<{ outputs: ParsedOutput[] }>>

/** Typed execute methods — narrows to known function names when ABI is literal */
export type TypedExecuteMethods<A extends ABI> =
  IsLiteral<FunctionNames<A>> extends true
    ? { [N in FunctionNames<A>]: (params: ExecuteParams) => Promise<{ transactionId: string; outputs: ParsedOutput[] }> }
    : Record<string, (params: ExecuteParams) => Promise<{ transactionId: string; outputs: ParsedOutput[] }>>

/** Typed write methods — narrows to known function names when ABI is literal */
export type TypedWriteMethods<A extends ABI> =
  IsLiteral<FunctionNames<A>> extends true
    ? { [N in FunctionNames<A>]: (params: WriteParams) => Promise<string> }
    : Record<string, (params: WriteParams) => Promise<string>>

// ── Typed contract instance ──────────────────────────────────────────

/** A contract instance with typed namespaces inferred from a literal ABI */
export type TypedContractInstance<A extends ABI> = {
  program: string
  abi: ABI | Program | undefined
  read: TypedReadMethods<A>
  write: TypedWriteMethods<A>
  simulate: TypedSimulateMethods<A>
  execute: TypedExecuteMethods<A>
  fetchAbi: () => Promise<Program>
}
