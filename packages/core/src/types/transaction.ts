/**
 * Transaction-related types, mirroring the Provable REST API wire format.
 *
 * Source: `~/dev/sdk/sdk/src/models/transaction/transactionJSON.ts` and siblings,
 * with corrections from live samples of `GET /{network}/transaction/{id}` (e.g.
 * `transition.scm` is on the wire but not in the SDK type).
 *
 * snake_case everywhere; `number` for u64 and smaller, `bigint` only for u128+.
 */

/**
 * A transition input on the wire.
 *
 * @property type Visibility kind (e.g. "public", "private", "record", "external_record").
 * @property tag Record tag — present on record inputs.
 * @property value Plaintext or ciphertext, depending on visibility; absent on record inputs.
 */
export type Input = {
  type: string
  id: string
  tag?: string
  value?: string
  dynamic_id?: string
}

/**
 * A transition output on the wire.
 *
 * @property type Visibility kind (e.g. "public", "private", "record", "future").
 */
export type Output = {
  type: string
  id: string
  checksum?: string
  /** Plaintext or ciphertext value, depending on visibility. */
  value?: string
  dynamic_id?: string
}

/** One program-function call within an execution, with its inputs, outputs, and commitments. */
export type Transition = {
  id: string
  program: string
  function: string
  inputs?: Input[]
  outputs?: Output[]
  /** Transition public key. */
  tpk: string
  /** Transition commitment. */
  tcm: string
  /**
   * Signer commitment. Present on the wire but not in the SDK `TransitionJSON` type.
   */
  scm?: string
}

/**
 * The execution part of an execute transaction: its transitions, the global
 * state root the proof was built against, and the proof itself.
 */
export type Execution = {
  transitions: Transition[]
  global_state_root: string
  proof: string
}

/** The fee part of a transaction: a single credits.aleo fee transition with its state root and proof. */
export type FeeExecution = {
  transition: Transition
  global_state_root: string
  proof: string
}

/** Verifying key entry: [function_name, [vk_hash, certificate]]. */
export type VerifyingKey = [string, [string, string]]

/** The deployment part of a deploy transaction: the program source and its verifying keys. */
export type Deployment = {
  /** u16 — deployment edition. */
  edition: number
  /** Aleo program source. */
  program: string
  verifying_keys: VerifyingKey[]
}

/** The deployer of a program: its address and signature over the deployment. */
export type Owner = {
  address: string
  signature: string
}

/**
 * A transaction as returned by the node's `GET /{network}/transaction/{id}`
 * endpoint. `execution` is present on execute transactions and `deployment`
 * on deploy transactions, matching `type`.
 */
export type Transaction = {
  /** "execute" | "deploy" | "fee" */
  type: string
  id: string
  execution?: Execution
  deployment?: Deployment
  fee: FeeExecution
  /** Deployer signature — present on deploy transactions. */
  owner?: Owner
}
