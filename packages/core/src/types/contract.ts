// Contract runtime types — used by getContract(), simulateContract(), executeContract().
// These describe the shapes that flow through the contract API at runtime.

import type { RecordValue, PlaintextValue, FutureValue, Plaintext } from './primitives.js'

// ── Parsed output types ───────────────────────────────────────────────

/** A parsed record output — fields resolved to native JS types with Aleo type info */
export type ParsedRecordOutput = {
  kind: 'record'
  name: string
  record: RecordValue
}

/** A parsed plaintext value output */
export type ParsedPlaintextOutput = {
  kind: 'plaintext'
  value: PlaintextValue
  type: Plaintext
}

/** An encrypted record the caller cannot decrypt */
export type EncryptedRecordOutput = {
  kind: 'encryptedRecord'
  ciphertext: string
  commitment: string
  program: string
  recordName: string
}

/** A finalize handle from an async transition */
export type ParsedFutureOutput = {
  kind: 'future'
  value: FutureValue
}

/** Union of possible parsed outputs */
export type ParsedOutput =
  | ParsedRecordOutput
  | ParsedPlaintextOutput
  | EncryptedRecordOutput
  | ParsedFutureOutput

// ── Input types ───────────────────────────────────────────────────────

/** Input value — either a pre-encoded string or a native JS value for auto-encoding */
export type InputValue = bigint | number | boolean | string

// ── Execute / simulate result types ───────────────────────────────────

export type TransitionResult = {
  transitionId: string
  program: string
  function: string
  outputs: ParsedOutput[]
}

export type ExecuteResult = {
  transactionId: string
  transitions: TransitionResult[]
  /** Top-level function's outputs (what the called function returns per its ABI) */
  outputs: ParsedOutput[]
}

export type SimulateResult = {
  outputs: ParsedOutput[]
}
