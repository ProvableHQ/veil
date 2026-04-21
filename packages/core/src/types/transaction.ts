/**
 * Transaction-related types, mirroring the Provable REST API wire format.
 *
 * Source: `~/dev/sdk/sdk/src/models/transaction/transactionJSON.ts` and siblings,
 * with corrections from live samples of `GET /{network}/transaction/{id}` (e.g.
 * `transition.scm` is on the wire but not in the SDK type).
 *
 * snake_case everywhere; `number` for u64 and smaller, `bigint` only for u128+.
 */

export type Input = {
  type: string
  id: string
  tag?: string
  value?: string
  dynamic_id?: string
}

export type Output = {
  type: string
  id: string
  checksum?: string
  /** Plaintext or ciphertext value, depending on visibility. */
  value?: string
  dynamic_id?: string
}

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

export type Execution = {
  transitions: Transition[]
  global_state_root: string
  proof: string
}

export type FeeExecution = {
  transition: Transition
  global_state_root: string
  proof: string
}

/** Verifying key entry: [function_name, [vk_hash, certificate]]. */
export type VerifyingKey = [string, [string, string]]

export type Deployment = {
  /** u16 — deployment edition. */
  edition: number
  /** Aleo program source. */
  program: string
  verifying_keys: VerifyingKey[]
}

export type Owner = {
  address: string
  signature: string
}

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
